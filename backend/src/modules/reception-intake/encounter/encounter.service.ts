import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Appointment, Prisma, ReceptionCheckin } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { generateUniqueCode } from '../../../common/utils/code-generator.util';
import { EncounterStatus } from '../../../common/utils/encounter-status.util';
import { FindEncountersQueryDto } from './dto/find-encounter-query.dto';

const ENCOUNTER_CODE_PREFIX = 'LK'; // "Lượt Khám" — theo cùng quy ước 2 ký tự với BN/LH/BS

@Injectable()
export class EncounterService {
  constructor(private readonly prisma: PrismaService) {}

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

  async findById(encounterId: string) {
    const encounter = await this.prisma.encounter.findUnique({
      where: { encounterId },
      include: {
        chiefComplaint: true,
        identityVerifications: { orderBy: { verifiedAt: 'desc' } },
        doctorQueueEntry: true,
        consents: true,
      },
    });
    if (!encounter) {
      throw new NotFoundException('Không tìm thấy lượt khám');
    }
    return encounter;
  }

  // GET /encounters?patientId=&status= — tra cứu lịch sử lượt khám của 1 bệnh nhân, hoặc lọc
  // theo trạng thái cho màn hình vận hành của lễ tân/bác sĩ.
  async findMany(query: FindEncountersQueryDto) {
    const where: Prisma.EncounterWhereInput = {
      patientId: query.patientId,
      status: query.status,
    };

    return this.prisma.encounter.findMany({
      where,
      orderBy: { arrivedAt: 'desc' },
      include: { chiefComplaint: true, doctorQueueEntry: true },
    });
  }
}