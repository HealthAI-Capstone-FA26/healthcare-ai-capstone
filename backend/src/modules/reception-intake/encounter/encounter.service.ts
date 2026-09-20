import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Appointment, Prisma, ReceptionCheckin } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { generateUniqueCode } from '../../../common/utils/code-generator.util';
import { EncounterStatus } from '../../../common/utils/encounter-status.util';
import { AppointmentStatus } from '../../../common/utils/appointment-status.util';
import { MANDATORY_CONSENT_POLICY_TYPES } from '../../../common/constants/triage-queue.constants';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { ConsentService } from '../consent/consent.service';
import { TriageQueueService } from '../triage-queue/triage-queue.service';
import { FindEncountersQueryDto } from './dto/find-encounter-query.dto';

const ENCOUNTER_CODE_PREFIX = 'LK'; // "Lượt Khám" — theo cùng quy ước 2 ký tự với BN/LH/BS

@Injectable()
export class EncounterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly consentService: ConsentService,
    private readonly triageQueueService: TriageQueueService,
  ) { }

  private generateEncounterCode(): Promise<string> {
    return generateUniqueCode(ENCOUNTER_CODE_PREFIX, async (code) => {
      const existing = await this.prisma.encounter.findUnique({ where: { encounterCode: code } });
      return Boolean(existing);
    });
  }

  /**
   * Điểm nối Module 2 -> Module 3: được gọi TRONG CÙNG transaction với
   * `QueueTicketService.done()` (xem queue-ticket.service.ts), ngay sau khi ticket chuyển sang
   * DONE (called -> done). Mỗi appointment chỉ có đúng 1 Encounter (appointmentId unique trên
   * bảng encounters). `done` ở đây là "ticket rời hàng đợi, chuyển sang khám", KHÔNG phải "khám
   * xong" — nên Encounter được tạo NGAY SAU done, mở đầu quy trình khám chứ không phải kết thúc.
   *
   * - `arrivedAt` lấy từ `checkin.checkinTime` (thời điểm lễ tân thực sự tiếp nhận ở quầy, tạo
   *   trong cùng transaction với done()), KHÔNG dùng default(now()) của schema.
   * - `patientType`: 'new' nếu bệnh nhân CHƯA từng có Encounter nào ở trạng thái 'finished'
   *   trước đó, ngược lại 'returning'. Dùng đúng lúc tạo (trong transaction) để tránh race với
   *   encounter đang tạo cùng lúc của chính bệnh nhân này (không thể tự đếm chính nó vì chưa insert).
   * - `doctorId` lấy từ `appointment.doctorId` (đã được gán trong cùng bước done()), có thể null
   *   nếu luồng nào đó chưa gán bác sĩ tại thời điểm done — cho phép null, DoctorQueueEntry ở
   *   Phase 6 mới là nơi bắt buộc phải có bác sĩ.
   */
  async createFromCheckin(
    tx: Prisma.TransactionClient,
    appointment: Appointment,
    checkin: ReceptionCheckin,
  ) {
    // Appointment ở case "matched nhưng chưa xác nhận" (guest booking, xem
    // GuestAppointmentService/Phase 1-2) có patientId = null cho tới khi lễ tân đối chiếu qua
    // POST /appointment/sync-patient (Phase 3). Encounter.patientId là bắt buộc (not null) nên
    // KHÔNG được tạo encounter khi chưa có patientId thật.
    if (!appointment.patientId) {
      throw new BadRequestException(
        'Lịch hẹn chưa xác nhận hồ sơ bệnh nhân, vui lòng đồng bộ (sync-patient) trước khi check-in',
      );
    }

    if (appointment.status !== AppointmentStatus.CHECKED_IN) {
      throw new BadRequestException(
        `Chỉ có thể tạo encounter khi appointment đang ở trạng thái '${AppointmentStatus.CHECKED_IN}'`,
      );
    }

    const paidConsultationInvoice = await tx.invoice.findFirst({
      where: {
        appointmentId: appointment.appointmentId,
        invoiceType: 'consultation',
        status: 'paid',
        items: { some: { itemType: 'consultation' } },
      },
      select: { invoiceId: true },
    });
    if (!paidConsultationInvoice) {
      throw new BadRequestException(
        'Bệnh nhân chưa thanh toán phí khám, không thể tạo encounter',
      );
    }

    const priorFinishedCount = await tx.encounter.count({
      where: { patientId: appointment.patientId, status: EncounterStatus.FINISHED },
    });
    const patientType = priorFinishedCount > 0 ? 'returning' : 'new';

    const encounterCode = await this.generateEncounterCode();

    return tx.encounter.create({
      data: {
        appointmentId: appointment.appointmentId,
        patientId: appointment.patientId,
        departmentId: appointment.departmentId,
        doctorId: appointment.doctorId,
        encounterCode,
        patientType,
        status: EncounterStatus.ARRIVED,
        arrivedAt: checkin.checkinTime,
      },
    });
  }

  /**
   * Điểm nối Module 3 (reception-intake) -> hàng đợi triage cho Module vitals (module3.md mục 5
   * PHASE 1). Kiểm tra đủ 3 điều kiện "đã khai báo xong reception-intake" — ChiefComplaint,
   * PatientIdentityVerification (verified) và Consent active cho từng policyType bắt buộc — rồi
   * chuyển Encounter.status arrived -> registered và xếp vào TriageQueueEntry. Việc chuyển tiếp
   * `waiting_for_doctor` sau khi đo sinh hiệu là TRÁCH NHIỆM CỦA MODULE VITALS, KHÔNG xử lý ở đây.
   *
   * Idempotency: transition arrived -> registered chỉ hợp lệ 1 lần — gọi lần 2 trên cùng encounter
   * (đã ở registered/waiting_for_doctor/...) sẽ bị chặn ngay ở bước kiểm tra status, không tạo
   * trùng TriageQueueEntry (encounterId unique trên bảng này).
   */
  async completeRegistration(encounterId: string, currentUser: RequestUser) {
    const encounter = await this.prisma.encounter.findUnique({
      where: { encounterId },
      include: {
        chiefComplaint: true,
        identityVerifications: { where: { verificationStatus: 'verified' }, take: 1 },
        patient: true,
      },
    });
    if (!encounter) {
      throw new NotFoundException('Không tìm thấy lượt khám');
    }
    if (encounter.status !== EncounterStatus.ARRIVED) {
      throw new BadRequestException(
        `Không thể hoàn tất đăng ký khi encounter đang ở trạng thái '${encounter.status}' (chỉ hợp lệ khi đang 'arrived')`,
      );
    }

    // Gom TẤT CẢ lỗi thiếu sót vào 1 mảng, không throw ngay ở điều kiện đầu tiên, để FE hiển thị
    // đủ 1 lần thay vì bắt lễ tân sửa từng lỗi một (module3.md mục 5 PHASE 1 BƯỚC 4).
    const missing: string[] = [];

    if (!encounter.chiefComplaint) {
      missing.push('Chưa khai báo lý do khám (chief complaint)');
    }

    // Chấp nhận identityVerified = true có sẵn trên Patient (bệnh nhân quen, đã xác minh ở lần
    // khám trước) để tránh bắt xác minh lại mỗi lần — xem module3.md mục 2 "Định danh tính đã
    // xác minh".
    if (encounter.identityVerifications.length === 0 && !encounter.patient.identityVerified) {
      missing.push('Chưa xác minh danh tính bệnh nhân');
    }

    for (const policyType of MANDATORY_CONSENT_POLICY_TYPES) {
      const hasConsent = await this.consentService.hasActivePolicyConsent(
        encounter.patientId,
        policyType,
      );
      if (!hasConsent) {
        missing.push(`Bệnh nhân chưa đồng ý chính sách bắt buộc: ${policyType}`);
      }
    }

    if (missing.length > 0) {
      throw new BadRequestException({
        message: 'Chưa hoàn tất thủ tục tiếp đón',
        missing,
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const priority =
        (
          await tx.appointment.findUnique({
            where: { appointmentId: encounter.appointmentId },
            select: { priority: true },
          })
        )?.priority ?? 'normal';

      const updatedEncounter = await tx.encounter.update({
        where: { encounterId },
        data: { status: EncounterStatus.REGISTERED, registeredAt: new Date() },
      });

      const triageQueueEntry = await this.triageQueueService.enqueue(
        tx,
        updatedEncounter,
        priority,
      );

      return { encounter: updatedEncounter, triageQueueEntry };
    });
  }

  async findById(encounterId: string) {
    const encounter = await this.prisma.encounter.findUnique({
      where: { encounterId },
      include: {
        chiefComplaint: true,
        identityVerifications: { orderBy: { verifiedAt: 'desc' } },
        doctorQueueEntry: true,
        consents: true,
        patient: true,
        department: true,
        doctor: true,
        vitalSignSessions: {
          orderBy: { createdAt: 'desc' },
          include: { observations: { include: { item: true } } },
        },
      },
    });
    if (!encounter) {
      throw new NotFoundException('Không tìm thấy lượt khám');
    }
    return encounter;
  }

  // GET /encounters?patientId=&doctorId=&departmentId=&status= — tra cứu lịch sử lượt khám của 1 bệnh nhân, hoặc lọc
  // theo trạng thái / bác sĩ / khoa phòng cho màn hình vận hành của lễ tân / bác sĩ.
  async findMany(query: FindEncountersQueryDto) {
    const where: Prisma.EncounterWhereInput = {
      ...(query.patientId && { patientId: query.patientId }),
      ...(query.doctorId && { doctorId: query.doctorId }),
      ...(query.departmentId && { departmentId: query.departmentId }),
      ...(query.status && { status: query.status }),
    };

    return this.prisma.encounter.findMany({
      where,
      orderBy: { arrivedAt: 'desc' },
      include: {
        chiefComplaint: true,
        doctorQueueEntry: true,
        patient: true,
        department: true,
        doctor: true,
        vitalSignSessions: {
          orderBy: { createdAt: 'desc' },
          include: { observations: { include: { item: true } } },
        },
      },
    });
  }
}