import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { MailService } from '../../mail/mail.service';
import { SmsService } from '../../sms/sms.service';
import { generateUniqueCode } from '../../../common/utils/code-generator.util';
import { generateOtp, hashOtp, otpExpiryDate } from '../../auth/common/otp.util';
import { assertOtpValid } from '../../auth/common/otp-validation.util';
import { AppointmentStatus } from '../../../common/utils/appointment-status.util';
import { PatientStatus } from '../../../common/constants/patient-status.constants';
import { PatientService } from '../patient/patient.service';
import { GuestAppointmentOtpStore } from './guest-appointment-otp.store';
import { GuestRequestOtpDto, GuestVerifyMethod } from './dto/guest-request-otp.dto';
import { GuestVerifyOtpDto } from './dto/guest-verify-otp.dto';

const APPOINTMENT_CODE_PREFIX = 'LH';

const GUEST_OTP_RATE_LIMIT = 5;
const GUEST_OTP_RATE_LIMIT_WINDOW_SECONDS = 10 * 60; // 10 phút

// Chỉ gợi ý patient status='main' khi đồng thời khớp số điện thoại và CCCD.
interface MatchCandidate {
  patientId: string;
  matchedFields: string[];
}

@Injectable()
export class GuestAppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly smsService: SmsService,
    private readonly guestOtpStore: GuestAppointmentOtpStore,
    private readonly patientService: PatientService,
  ) {}

  private getOtpExpiryMinutes(): number {
    return Number(this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? 5);
  }

  // POST /appointments/guest/request-otp — lưu tạm thông tin đặt lịch cùng OTP rồi gửi OTP.
  async requestOtp(dto: GuestRequestOtpDto) {
    if (dto.verifyMethod === GuestVerifyMethod.EMAIL && !dto.email) {
      throw new BadRequestException('Cần cung cấp email khi chọn kênh xác thực OTP là email');
    }

    await this.enforceRateLimit(dto.phoneNumber);

    const otp = generateOtp();
    const otpCodeHash = await hashOtp(otp);
    const otpExpiresAt = otpExpiryDate(this.getOtpExpiryMinutes());

    await this.guestOtpStore.upsert(GuestAppointmentOtpStore.id(dto.phoneNumber), {
      phoneNumber: dto.phoneNumber,
      email: dto.email,
      appointmentData: dto,
      otpCodeHash,
      otpExpiresAt,
    });

    if (dto.verifyMethod === GuestVerifyMethod.SMS) {
      await this.smsService.sendGuestAppointmentOtpSms(dto.phoneNumber, otp);
    } else {
      await this.mailService.sendGuestAppointmentOtpMail(dto.email as string, otp);
    }

    return {
      message:
        dto.verifyMethod === GuestVerifyMethod.SMS
          ? 'Đã gửi mã OTP xác thực tới SĐT của bạn'
          : `Đã gửi mã OTP xác thực tới email ${dto.email}`,
    };
  }

  // POST /appointments/guest/verify-otp — Bước 2: verify đúng OTP (theo phoneNumber) rồi mới xử
  // lý thông tin đặt lịch đã lưu ở bước request-otp:
  // - Tìm được patient status='main' khớp cả phoneNumber và identityNumber -> tạo Appointment với
  //   suggestedPatientId = ứng viên khớp nhất, patientId để NULL.
  // - Không khớp đủ cả hai field -> tạo Patient status='draft' và gắn patientId vào Appointment.
  // Toàn bộ nằm trong CÙNG 1 transaction với tạo Appointment + trừ chỗ slot.
  async verifyOtp(dto: GuestVerifyOtpDto) {
    const otpId = GuestAppointmentOtpStore.id(dto.phoneNumber);
    const pending = await this.guestOtpStore.find(otpId);
    if (!pending) {
      throw new BadRequestException('Không tìm thấy yêu cầu xác thực, vui lòng gửi lại mã OTP');
    }

    await assertOtpValid(
      pending,
      dto.otp,
      {
        expired: 'Mã OTP đã hết hạn, vui lòng gửi lại mã OTP',
        maxAttemptsExceeded: 'Bạn đã nhập sai OTP quá số lần cho phép, vui lòng gửi lại mã OTP',
        invalidOtp: 'Mã OTP không chính xác',
      },
      {
        onExpiredOrMaxAttempts: () => this.guestOtpStore.delete(otpId),
        onWrongAttempt: () => this.guestOtpStore.incrementAttempts(otpId).then(() => undefined),
      },
    );

    const appointmentDto = pending.appointmentData;

    if (dto.email && dto.email !== appointmentDto.email) {
      throw new BadRequestException('Email không trùng với email đã dùng để gửi yêu cầu OTP');
    }

    // Slot còn trống + đúng khoa — check ngay ở đây (atomic hơn nữa được xử lý lại trong
    // transaction bằng updateMany bên dưới, phòng race condition giữa lúc check và lúc đặt).
    const slot = await this.assertSlotBookable(
      appointmentDto.departmentId,
      appointmentDto.doctorId,
      appointmentDto.slotId,
    );

    const appointmentCode = await generateUniqueCode(APPOINTMENT_CODE_PREFIX, async (code) => {
      const existing = await this.prisma.appointment.findUnique({ where: { appointmentCode: code } });
      return Boolean(existing);
    });

    const result = await this.prisma.$transaction(async (tx) => {
      const { patientId, suggestedPatientId, suggestedReason } = await this.resolvePatientForBooking(
        tx,
        appointmentDto,
      );

      const appointment = await tx.appointment.create({
        data: {
          appointmentCode,
          bookingChannel: 'online',
          status: AppointmentStatus.PENDING,
          patientId,
          suggestedPatientId,
          suggestedReason,
          doctorId: appointmentDto.doctorId,
          departmentId: appointmentDto.departmentId,
          slotId: appointmentDto.slotId,
          bookedByUserId: null,
          appointmentDate: slot.slotStartTime,
          appointmentTime: slot.slotStartTime,
          reasonForVisit: appointmentDto.reasonForVisit,
          priority: appointmentDto.priority,
        },
      });

      const slotUpdateResult = await tx.appointmentSlot.updateMany({
        where: { slotId: appointmentDto.slotId, bookedCount: { lt: slot.capacity } },
        data: { bookedCount: { increment: 1 } },
      });
      if (slotUpdateResult.count === 0) {
        throw new ConflictException('Slot đã đầy, vui lòng chọn slot khác');
      }

      const newBookedCount = slot.bookedCount + 1;
      if (newBookedCount >= slot.capacity) {
        await tx.appointmentSlot.update({
          where: { slotId: appointmentDto.slotId },
          data: { status: 'full' },
        });
      }

      return appointment;
    });

    await this.guestOtpStore.delete(otpId);
    return result;
  }

  // Chỉ query patient main khi cả số điện thoại và CCCD cùng khớp.
  private async resolvePatientForBooking(
    tx: Prisma.TransactionClient,
    dto: GuestRequestOtpDto,
  ): Promise<{ patientId: string | null; suggestedPatientId: string | null; suggestedReason: string | null }> {
    const mainCandidates = await tx.patient.findMany({
      where: {
        status: PatientStatus.MAIN,
        phoneNumber: dto.phoneNumber,
        identityNumber: dto.identityNumber,
      },
    });

    const best = this.pickBestMatch(mainCandidates, dto);

    if (best) {
      return {
        patientId: null,
        suggestedPatientId: best.patientId,
        suggestedReason: best.matchedFields.join(','),
      };
    }

    // CCCD là unique. Nếu một lần đặt lịch trước đó đã tạo draft với cùng CCCD,
    // dùng lại draft này thay vì cố tạo bản ghi mới rồi bị lỗi duplicate.
    const existingDraft = await tx.patient.findFirst({
      where: {
        status: PatientStatus.DRAFT,
        identityNumber: dto.identityNumber,
      },
      select: { patientId: true },
    });
    if (existingDraft) {
      return { patientId: existingDraft.patientId, suggestedPatientId: null, suggestedReason: null };
    }

    // Không tìm thấy patient main hoặc draft hiện có -> tạo patient draft mới.
    const draftPatient = await this.patientService.createDraftPatientRecord(
      {
        fullName: dto.fullName,
        dateOfBirth: dto.dateOfBirth,
        gender: dto.gender,
        identityNumber: dto.identityNumber,
        phoneNumber: dto.phoneNumber,
        email: dto.email,
      },
      tx,
    );

    return { patientId: draftPatient.patientId, suggestedPatientId: null, suggestedReason: null };
  }

  private pickBestMatch(
    candidates: { patientId: string; fullName: string; dateOfBirth: Date; phoneNumber: string; identityNumber: string | null }[],
    dto: GuestRequestOtpDto,
  ): MatchCandidate | null {
    let best: MatchCandidate | null = null;

    for (const candidate of candidates) {
      const matchedFields: string[] = [];

      if (candidate.phoneNumber === dto.phoneNumber) {
        matchedFields.push('phoneNumber');
      }
      if (candidate.identityNumber && candidate.identityNumber === dto.identityNumber) {
        matchedFields.push('identityNumber');
      }

      if (!best || matchedFields.length > best.matchedFields.length) {
        best = { patientId: candidate.patientId, matchedFields };
      }
    }

    return best;
  }

  private async assertSlotBookable(departmentId: string, doctorId: string, slotId: string) {
    const slot = await this.prisma.appointmentSlot.findUnique({
      where: { slotId },
      include: { schedule: true },
    });
    if (!slot || slot.status !== 'free') {
      throw new BadRequestException('Slot không tồn tại hoặc đã hết chỗ');
    }
    if (slot.schedule.departmentId !== departmentId) {
      throw new BadRequestException('Slot không thuộc khoa đã chọn');
    }
    if (slot.schedule.doctorId !== doctorId) {
      throw new BadRequestException('Slot không thuộc bác sĩ đã chọn');
    }
    return slot;
  }

  // Rate-limit theo phoneNumber — guest chưa đăng nhập nên không có userId để khoá theo như
  // contact-request; phoneNumber là định danh duy nhất khả dụng lúc này.
  private async enforceRateLimit(phoneNumber: string) {
    const client = this.redis.getClient();
    const key = `guest-appointment-otp-rl:${phoneNumber}`;

    const attempts = await client.incr(key);
    if (attempts === 1) {
      await client.expire(key, GUEST_OTP_RATE_LIMIT_WINDOW_SECONDS);
    }
    if (attempts > GUEST_OTP_RATE_LIMIT) {
      throw new BadRequestException('Bạn thao tác quá nhiều lần, vui lòng thử lại sau ít phút');
    }
  }
}
