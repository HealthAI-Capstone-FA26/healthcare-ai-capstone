import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { RedisService } from '../../../../redis/redis.service';
import { MailService } from '../../../platform/mail/mail.service';
import { SmsService } from '../../../platform/sms/sms.service';
import { generateUniqueCode } from '../../../../common/utils/code-generator.util';
import { generateOtp, hashOtp, otpExpiryDate } from '../../../identity-access/auth/common/otp.util';
import { assertOtpValid } from '../../../identity-access/auth/common/otp-validation.util';
import { AppointmentStatus } from '../../../../common/utils/appointment-status.util';
import { PatientStatus } from '../../../../common/constants/patient-status.constants';
import { PatientService } from '../patient/patient.service';
import { getHospitalWallClockNow } from '../../../../common/utils/hospital-clock.util';
import { GuestAppointmentOtpStore } from './guest-appointment-otp.store';
import { GuestRequestOtpDto, GuestVerifyMethod } from './dto/guest-request-otp.dto';
import { GuestVerifyOtpDto } from './dto/guest-verify-otp.dto';

const APPOINTMENT_CODE_PREFIX = 'LH';

const GUEST_OTP_RATE_LIMIT = 5;
const GUEST_OTP_RATE_LIMIT_WINDOW_SECONDS = 10 * 60; // 10 phút

function normalizeFullName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
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
  ) { }

  private getOtpExpiryMinutes(): number {
    return Number(this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? 5);
  }

  // POST /appointments/guest/request-otp — lưu tạm thông tin đặt lịch cùng OTP rồi gửi OTP.
  async requestOtp(dto: GuestRequestOtpDto) {
    if (dto.verifyMethod === GuestVerifyMethod.EMAIL && !dto.email) {
      throw new BadRequestException('Cần cung cấp email khi chọn kênh xác thực OTP là email');
    }

    // Kiểm tra slot còn trống, đúng bác sĩ và chưa quá hạn trước khi gửi OTP
    await this.assertSlotBookable(dto.doctorId, dto.slotId);

    // Kiểm tra sớm xung đột hồ sơ bệnh nhân (SĐT/Email đã thuộc về hồ sơ khác tên) trước khi gửi OTP
    await this.findAndValidateExistingPatient(this.prisma, dto);

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

    // Slot còn trống + đúng bác sĩ — check ngay ở đây (atomic hơn nữa được xử lý lại trong
    // transaction bằng updateMany bên dưới, phòng race condition giữa lúc check và lúc đặt).
    const slot = await this.assertSlotBookable(
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

  // Tìm hồ sơ bệnh nhân hiện có (main hoặc draft) theo SĐT hoặc Email:
  // - Nếu khớp hồ sơ có sẵn và đúng họ tên:
  //   + status = 'main' -> gán suggestedPatientId (để lễ tân đối chiếu qua sync-patient).
  //   + status = 'draft' -> tái sử dụng luôn patientId của hồ sơ draft đó (không tạo bản ghi trùng).
  // - Nếu trùng SĐT/Email với hồ sơ có sẵn nhưng lệch họ tên (hoặc SĐT/Email thuộc 2 hồ sơ khác nhau) -> báo lỗi ConflictException.
  // - Nếu chưa có hồ sơ nào -> tạo mới Patient status = 'draft'.
  private async resolvePatientForBooking(
    tx: Prisma.TransactionClient,
    dto: GuestRequestOtpDto,
  ): Promise<{ patientId: string | null; suggestedPatientId: string | null; suggestedReason: string | null }> {
    const existingPatient = await this.findAndValidateExistingPatient(tx, dto);

    if (existingPatient) {
      if (dto.email && !existingPatient.email) {
        await tx.patient.update({
          where: { patientId: existingPatient.patientId },
          data: { email: dto.email },
        });
      }

      if (existingPatient.status === PatientStatus.MAIN) {
        const matchedFields: string[] = ['phoneNumber'];
        if (dto.email && existingPatient.email?.toLowerCase() === dto.email.toLowerCase()) {
          matchedFields.push('email');
        }
        return {
          patientId: null,
          suggestedPatientId: existingPatient.patientId,
          suggestedReason: matchedFields.join(','),
        };
      }

      // Hồ sơ đang ở trạng thái 'draft' -> tái sử dụng luôn cho lịch hẹn mới
      return {
        patientId: existingPatient.patientId,
        suggestedPatientId: null,
        suggestedReason: null,
      };
    }

    // Không tìm thấy patient main hoặc draft hiện có -> tạo patient draft mới.
    const draftPatient = await this.patientService.createDraftPatientRecord(
      {
        fullName: dto.fullName,
        dateOfBirth: dto.dateOfBirth,
        gender: dto.gender,
        phoneNumber: dto.phoneNumber,
        email: dto.email,
      },
      tx,
    );

    return { patientId: draftPatient.patientId, suggestedPatientId: null, suggestedReason: null };
  }

  private async findAndValidateExistingPatient(
    db: Prisma.TransactionClient | PrismaService,
    dto: GuestRequestOtpDto,
  ) {
    const orConditions: Prisma.PatientWhereInput[] = [{ phoneNumber: dto.phoneNumber }];
    if (dto.email) {
      orConditions.push({ email: { equals: dto.email, mode: 'insensitive' } });
    }

    const candidates = await db.patient.findMany({
      where: { OR: orConditions },
    });

    if (candidates.length === 0) {
      return null;
    }

    const byPhone = candidates.find((p) => p.phoneNumber === dto.phoneNumber);
    const byEmail = dto.email
      ? candidates.find((p) => p.email?.toLowerCase() === dto.email!.toLowerCase())
      : undefined;

    if (byPhone && byEmail && byPhone.patientId !== byEmail.patientId) {
      throw new ConflictException(
        'Số điện thoại và email đang thuộc về hai hồ sơ bệnh nhân khác nhau. Vui lòng kiểm tra lại thông tin',
      );
    }

    const matched = byPhone ?? byEmail!;

    if (matched.phoneNumber !== dto.phoneNumber) {
      throw new ConflictException(
        'Email này đã được đăng ký với một số điện thoại khác. Vui lòng nhập đúng số điện thoại của hồ sơ đã có hoặc dùng email khác',
      );
    }

    if (dto.email && matched.email && matched.email.toLowerCase() !== dto.email.toLowerCase()) {
      throw new ConflictException(
        'Số điện thoại này đã được đăng ký với một email khác. Vui lòng nhập đúng email của hồ sơ đã có hoặc dùng số điện thoại khác',
      );
    }

    if (normalizeFullName(matched.fullName) !== normalizeFullName(dto.fullName)) {
      throw new ConflictException(
        'Số điện thoại hoặc email này đã được đăng ký cho hồ sơ bệnh nhân khác. Vui lòng nhập đúng họ tên hồ sơ cũ hoặc dùng SĐT/Email khác',
      );
    }

    return matched;
  }

  private async assertSlotBookable(doctorId: string, slotId: string) {
    const slot = await this.prisma.appointmentSlot.findUnique({
      where: { slotId },
      include: { schedule: true },
    });
    if (!slot || slot.status !== 'free') {
      throw new BadRequestException('Slot không tồn tại hoặc đã hết chỗ');
    }
    if (slot.schedule.doctorId !== doctorId) {
      throw new BadRequestException('Slot không thuộc bác sĩ đã chọn');
    }
    if (slot.slotStartTime.getTime() <= getHospitalWallClockNow().getTime()) {
      throw new BadRequestException('Khung giờ khám này đã kết thúc hoặc không còn khả dụng để đặt lịch');
    }
    return slot;
  }

  // Rate-limit theo phoneNumber — guest chưa đăng nhập nên không có userId để khoá theo;
  // phoneNumber là định danh duy nhất khả dụng lúc này.
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
