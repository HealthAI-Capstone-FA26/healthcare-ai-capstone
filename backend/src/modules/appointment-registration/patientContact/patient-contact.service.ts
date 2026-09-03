import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { MailService } from '../../mail/mail.service';
import { SmsService } from '../../sms/sms.service';
import {
  isPendingRelationship,
  PENDING_RELATIONSHIP_PREFIX,
  stripPendingPrefix,
} from '../../../common/constants/patient-contact.constants';
import { CreateContactRequestDto, ContactVerifyMethod } from './dto/create-contact-request.dto';
import { VerifyContactRequestOtpDto } from './dto/verify-contact-request-otp.dto';
import { ContactRequestOtpStore } from './contact-request-otp.store';
import { generateOtp, hashOtp, otpExpiryDate } from '../../auth/common/otp.util';
import { assertOtpValid } from '../../auth/common/otp-validation.util';

const CONTACT_REQUEST_RATE_LIMIT = 5;
const CONTACT_REQUEST_RATE_LIMIT_WINDOW_SECONDS = 10 * 60; // 10 phút

@Injectable()
export class PatientContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly smsService: SmsService,
    private readonly contactRequestOtpStore: ContactRequestOtpStore,
  ) {}

  private getOtpExpiryMinutes(): number {
    return Number(this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? 5);
  }

  /**
   * Trả về PatientContact nếu (userId, patientId) đã có contact "sạch" (đã duyệt / tự đủ điều
   * kiện) — tức KHÔNG có prefix `pending:`. Dùng chung bởi: check quyền xem hồ sơ
   * (GET /patients/:id/full), list "hồ sơ tôi quản lý" (GET /patients/my), và validate
   * đặt lịch giúp người thân (Phase 4/5 appointment).
   */
  async findApprovedContact(userId: string, patientId: string) {
    const contact = await this.prisma.patientContact.findUnique({
      where: { userId_patientId: { userId, patientId } },
    });
    if (!contact || isPendingRelationship(contact.relationship)) {
      return null;
    }
    return contact;
  }

  // POST /patients/contact-requests — Bước 1: KHÔNG nhận patientId từ client (tránh lộ/patientId
  // bị dò theo URL) — người thân tự nhập đủ thông tin định danh, hệ thống tự tìm patient tương
  // ứng qua identityNumber (unique) rồi đối chiếu lại toàn bộ field. Không còn tạo PatientContact
  // "pending" chờ chủ hồ sơ duyệt như flow cũ; contact chỉ được tạo sau khi verify OTP đúng
  // (xem verifyContactRequestOtp).
  async createContactRequest(currentUser: RequestUser, dto: CreateContactRequestDto) {
    // Rate-limit theo (currentUser.userId, identityNumber) để chống brute-force dò thông tin định danh —
    // giới hạn ngay từ đây vì patientId chưa xác định được lúc này.
    await this.enforceContactRequestRateLimit(currentUser.userId, dto.identityNumber);

    const patient = await this.prisma.patient.findUnique({
      where: { identityNumber: dto.identityNumber },
    });

    // Match đồng thời cả 4 field — kể cả khi identityNumber không tồn tại cũng trả lỗi chung
    // chung y hệt trường hợp sai field khác, không tiết lộ identityNumber có tồn tại hay không.
    const matched =
      !!patient &&
      patient.fullName.trim().toLowerCase() === dto.fullName.trim().toLowerCase() &&
      patient.dateOfBirth.toISOString().slice(0, 10) === dto.dateOfBirth.slice(0, 10) &&
      patient.phoneNumber === dto.phoneNumber;
    if (!matched || !patient) {
      throw new BadRequestException('Thông tin không khớp với hồ sơ bệnh nhân');
    }

    const patientId = patient.patientId;

    // Check kênh OTP đã chọn phải khớp với thông tin liên lạc đã lưu trong hồ sơ patient —
    // tránh spam email/sms tuỳ ý tới người không liên quan. SMS đã được đảm bảo khớp qua bước
    // match phoneNumber ở trên nên chỉ cần check thêm cho EMAIL (field độc lập với patient.email).
    if (dto.verifyMethod === ContactVerifyMethod.EMAIL) {
      if (!patient.email) {
        throw new BadRequestException('Bệnh nhân chưa khai báo email trong hồ sơ');
      }
      if (patient.email.trim().toLowerCase() !== (dto.email as string).trim().toLowerCase()) {
        throw new BadRequestException('Email không khớp với email đã lưu trong hồ sơ bệnh nhân');
      }
    }

    // Unique key (userId, patientId) đảm bảo 1 user chỉ có tối đa 1 contact với 1 patient —
    // không cho gửi OTP mới nếu đã là contact hợp lệ rồi.
    const existing = await this.prisma.patientContact.findUnique({
      where: { userId_patientId: { userId: currentUser.userId, patientId } },
    });
    if (existing && !isPendingRelationship(existing.relationship)) {
      throw new ConflictException('Bạn đã là người liên hệ hợp lệ của bệnh nhân này');
    }

    const otp = generateOtp();
    const otpCodeHash = await hashOtp(otp);
    const otpExpiresAt = otpExpiryDate(this.getOtpExpiryMinutes());

    await this.contactRequestOtpStore.upsert(ContactRequestOtpStore.id(currentUser.userId), {
      userId: currentUser.userId,
      patientId,
      relationship: dto.relationship,
      otpCodeHash,
      otpExpiresAt,
    });

    // Kênh gửi OTP do người gửi request tự chọn: SMS -> gửi tới SĐT patient (field vừa được
    // match ở trên nên chắc chắn đúng); EMAIL -> gửi tới email do người gửi tự nhập trong dto
    // (KHÔNG dùng patient.email vì field đó optional, có thể không tồn tại).
    if (dto.verifyMethod === ContactVerifyMethod.SMS) {
      await this.smsService.sendOtpSms(patient.phoneNumber, otp);
    } else {
      await this.mailService.sendContactRequestOtpMail(dto.email as string, otp);
    }

    return {
      message:
        dto.verifyMethod === ContactVerifyMethod.SMS
          ? 'Đã gửi mã OTP xác thực tới SĐT của bệnh nhân'
          : `Đã gửi mã OTP xác thực tới email ${dto.email}`,
    };
  }

  // POST /patients/contact-requests/verify-otp — Bước 2: cũng KHÔNG cần patientId — chỉ cần OTP,
  // patient tương ứng được lấy lại từ record OTP đã lưu ở bước 1 (khoá theo currentUser.userId).
  // Verify đúng -> tạo thẳng PatientContact đã duyệt, không qua bước accept/reject của chủ hồ sơ nữa.
  async verifyContactRequestOtp(currentUser: RequestUser, dto: VerifyContactRequestOtpDto) {
    const otpId = ContactRequestOtpStore.id(currentUser.userId);
    const pending = await this.contactRequestOtpStore.find(otpId);
    if (!pending) {
      throw new BadRequestException('Không tìm thấy yêu cầu xác thực nào, vui lòng gửi lại yêu cầu');
    }

    await assertOtpValid(
      pending,
      dto.otp,
      {
        expired: 'Mã OTP đã hết hạn, vui lòng gửi lại yêu cầu',
        maxAttemptsExceeded: 'Bạn đã nhập sai OTP quá số lần cho phép, vui lòng gửi lại yêu cầu',
        invalidOtp: 'Mã OTP không chính xác',
      },
      {
        onExpiredOrMaxAttempts: () => this.contactRequestOtpStore.delete(otpId),
        onWrongAttempt: () => this.contactRequestOtpStore.incrementAttempts(otpId).then(() => undefined),
      },
    );

    try {
      const contact = await this.prisma.patientContact.create({
        data: {
          userId: pending.userId,
          patientId: pending.patientId,
          relationship: pending.relationship,
          isPrimaryContact: false,
        },
      });
      await this.contactRequestOtpStore.delete(otpId);
      return contact;
    } catch (err) {
      // Fallback chống race condition: 2 lần verify gần như đồng thời, hoặc contact đã được tạo
      // qua đường khác giữa lúc gửi OTP và lúc verify.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        await this.contactRequestOtpStore.delete(otpId);
        throw new ConflictException('Bạn đã là người liên hệ của bệnh nhân này');
      }
      throw err;
    }
  }

  // GET /patients/my-requests — request mà currentUser đã gửi và đang pending:*
  async listMyRequests(currentUser: RequestUser) {
    const contacts = await this.prisma.patientContact.findMany({
      where: { userId: currentUser.userId, relationship: { startsWith: PENDING_RELATIONSHIP_PREFIX } },
      include: { patient: true },
      orderBy: { createdAt: 'desc' },
    });

    return contacts.map((contact) => ({
      contactId: contact.contactId,
      patientId: contact.patientId,
      patientFullName: contact.patient.fullName,
      relationship: stripPendingPrefix(contact.relationship),
      createdAt: contact.createdAt,
    }));
  }

  private async enforceContactRequestRateLimit(userId: string, identityNumber: string) {
    const client = this.redis.getClient();
    const key = `contact-request-rl:${userId}:${identityNumber}`;

    const attempts = await client.incr(key);
    if (attempts === 1) {
      await client.expire(key, CONTACT_REQUEST_RATE_LIMIT_WINDOW_SECONDS);
    }
    if (attempts > CONTACT_REQUEST_RATE_LIMIT) {
      throw new BadRequestException(
        'Bạn thao tác quá nhiều lần, vui lòng thử lại sau ít phút',
      );
    }
  }
}