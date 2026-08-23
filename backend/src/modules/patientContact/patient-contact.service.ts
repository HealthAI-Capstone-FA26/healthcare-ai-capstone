import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { RequestUser } from '../auth/strategies/jwt.strategy';
import {
  isPendingRelationship,
  PENDING_RELATIONSHIP_PREFIX,
  stripPendingPrefix,
  toPendingRelationship,
} from '../../common/constants/patient-contact.constants';
import { CreateContactRequestDto } from './dto/create-contact-request.dto';

const CONTACT_REQUEST_RATE_LIMIT = 5;
const CONTACT_REQUEST_RATE_LIMIT_WINDOW_SECONDS = 10 * 60; // 10 phút

@Injectable()
export class PatientContactService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

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

  // POST /patients/:id/contact-requests — người thân tự gọi để xin quyền làm contact.
  async createContactRequest(
    patientId: string,
    currentUser: RequestUser,
    dto: CreateContactRequestDto,
  ) {
    const patient = await this.prisma.patient.findUnique({ where: { patientId } });
    if (!patient) {
      throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');
    }

    // Rate-limit theo (currentUser.userId, patientId) để chống brute-force dò identityNumber/phoneNumber.
    await this.enforceContactRequestRateLimit(currentUser.userId, patientId);

    // Match đồng thời cả 2 field — sai dù chỉ 1 field cũng trả lỗi chung chung, không nói rõ sai chỗ nào.
    const matched =
      patient.identityNumber === dto.identityNumber && patient.phoneNumber === dto.phoneNumber;
    if (!matched) {
      throw new BadRequestException('Thông tin không khớp với hồ sơ bệnh nhân');
    }

    // Unique key (userId, patientId) đảm bảo 1 user chỉ có tối đa 1 request/contact với 1 patient
    // tại 1 thời điểm — không đè dữ liệu đã có (dù đang pending hay đã duyệt), trả lỗi rõ ràng.
    const existing = await this.prisma.patientContact.findUnique({
      where: { userId_patientId: { userId: currentUser.userId, patientId } },
    });
    if (existing) {
      throw new ConflictException(
        isPendingRelationship(existing.relationship)
          ? 'Bạn đã gửi yêu cầu cho bệnh nhân này, vui lòng chờ chủ hồ sơ duyệt'
          : 'Bạn đã là người liên hệ hợp lệ của bệnh nhân này',
      );
    }

    try {
      return await this.prisma.patientContact.create({
        data: {
          userId: currentUser.userId,
          patientId,
          relationship: toPendingRelationship(dto.relationship),
          isPrimaryContact: false,
        },
      });
    } catch (err) {
      // Fallback chống race condition: 2 request gửi gần như đồng thời cùng vượt qua check `existing` ở trên.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Bạn đã gửi yêu cầu hoặc là người liên hệ của bệnh nhân này');
      }
      throw err;
    }
  }

  // GET /patients/:id/contact-requests — chỉ chủ hồ sơ gọi được.
  async listContactRequests(patientId: string, currentUser: RequestUser) {
    await this.assertIsPatientOwner(patientId, currentUser);

    const pendingContacts = await this.prisma.patientContact.findMany({
      where: { patientId, relationship: { startsWith: PENDING_RELATIONSHIP_PREFIX } },
      orderBy: { createdAt: 'desc' },
    });

    return pendingContacts.map((contact) => ({
      contactId: contact.contactId,
      requestedByUserId: contact.userId,
      relationship: stripPendingPrefix(contact.relationship),
      createdAt: contact.createdAt,
    }));
  }

  // PATCH /patients/:id/contact-requests/:contactId/accept — chỉ chủ hồ sơ.
  async acceptContactRequest(patientId: string, contactId: string, currentUser: RequestUser) {
    await this.assertIsPatientOwner(patientId, currentUser);
    const contact = await this.findPendingContactOrThrow(patientId, contactId);

    return this.prisma.patientContact.update({
      where: { contactId },
      data: { relationship: stripPendingPrefix(contact.relationship) },
    });
  }

  // PATCH /patients/:id/contact-requests/:contactId/reject — chỉ chủ hồ sơ.
  async rejectContactRequest(patientId: string, contactId: string, currentUser: RequestUser) {
    await this.assertIsPatientOwner(patientId, currentUser);
    await this.findPendingContactOrThrow(patientId, contactId);

    await this.prisma.patientContact.delete({ where: { contactId } });
    return { deleted: true };
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

  private async assertIsPatientOwner(patientId: string, currentUser: RequestUser) {
    const patient = await this.prisma.patient.findUnique({ where: { patientId } });
    if (!patient) {
      throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');
    }
    if (patient.userId !== currentUser.userId) {
      throw new ForbiddenException('Chỉ chủ hồ sơ mới có quyền thực hiện thao tác này');
    }
    return patient;
  }

  private async findPendingContactOrThrow(patientId: string, contactId: string) {
    const contact = await this.prisma.patientContact.findUnique({ where: { contactId } });
    if (!contact || contact.patientId !== patientId || !isPendingRelationship(contact.relationship)) {
      throw new NotFoundException('Không tìm thấy yêu cầu liên hệ đang chờ duyệt');
    }
    return contact;
  }

  private async enforceContactRequestRateLimit(userId: string, patientId: string) {
    const client = this.redis.getClient();
    const key = `contact-request-rl:${userId}:${patientId}`;

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
