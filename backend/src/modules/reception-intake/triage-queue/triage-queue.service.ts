import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Encounter, Prisma, TriageQueueEntry } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { toDateOnlyUTC } from '../../../common/constants/queue-ticket.constants';
import { getHospitalWallClockNow } from '../../../common/utils/hospital-clock.util';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import {
  compareTriageQueueEntries,
  TriageQueueStatus,
} from '../../../common/constants/triage-queue.constants';

// Các trạng thái được tính là "đang bận việc" khi round-robin chọn y tá — done/skipped/cancelled
// không tính vì y tá đã rảnh tay với ca đó.
const ACTIVE_TRIAGE_STATUSES = [
  TriageQueueStatus.WAITING,
  TriageQueueStatus.CALLED,
  TriageQueueStatus.IN_PROGRESS,
];

@Injectable()
export class TriageQueueService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Điểm nối Module 3 (reception-intake) -> hàng đợi triage cho Module vitals: được gọi TRONG
   * CÙNG transaction với bước chuyển Encounter.status arrived -> registered (xem
   * EncounterService.completeRegistration). Việc chuyển tiếp waiting_for_doctor sau khi đo sinh
   * hiệu là trách nhiệm của module vitals, KHÔNG xử lý ở đây.
   *
   * Chống race condition sinh queueOrder theo pattern BẮT BUỘC của
   * QueueTicketService.issueTicketForAppointment: (1) pg_advisory_xact_lock theo key
   * (departmentId, ngày) để serialize các transaction cùng sinh số cho cùng khoa/ngày; (2) bắt lỗi
   * unique constraint P2002 ([departmentId, triageQueueDate, queueOrder]) và retry 1 lần, phòng
   * trường hợp advisory lock không khả dụng.
   */
  async enqueue(
    tx: Prisma.TransactionClient,
    encounter: Encounter,
    priority: string,
  ): Promise<TriageQueueEntry> {
    const triageQueueDate = toDateOnlyUTC(getHospitalWallClockNow());
    const lockKey = `${encounter.departmentId}:${triageQueueDate.toISOString().slice(0, 10)}`;

    // pg_advisory_xact_lock tự release khi transaction kết thúc (commit/rollback).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    // assignNurse chỉ cần chạy 1 lần: kết quả (userId của y tá ít việc nhất) không phụ thuộc vào
    // queueOrder, nên không cần tính lại trong vòng lặp retry bên dưới.
    const assignedNurseUserId = await this.assignNurse(tx, encounter.departmentId, triageQueueDate);

    for (let attempt = 0; attempt < 2; attempt++) {
      const queueOrder = await this.nextQueueOrder(tx, encounter.departmentId, triageQueueDate);

      try {
        return await tx.triageQueueEntry.create({
          data: {
            encounterId: encounter.encounterId,
            assignedNurseUserId,
            departmentId: encounter.departmentId,
            priority,
            queueOrder,
            status: TriageQueueStatus.WAITING,
            triageQueueDate,
          },
        });
      } catch (error) {
        const isUniqueConflict =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!isUniqueConflict) {
          throw error;
        }
        // Đụng unique constraint dù đã có advisory lock (hiếm) -> để vòng lặp tự retry với số
        // mới. KHÔNG rethrow ở đây kể cả khi đây đã là lần thử cuối (attempt === 1): phải để
        // vòng lặp kết thúc tự nhiên và rơi xuống BadRequestException thân thiện bên dưới, thay
        // vì làm lộ ra lỗi PrismaClientKnownRequestError thô cho phía trên.
      }
    }

    throw new BadRequestException('Không thể xếp hàng đợi triage, vui lòng thử lại');
  }

  // Tìm số thứ tự tiếp theo trong ngày/khoa — giống hệt cách nextTicketNumber của QueueTicketService.
  private async nextQueueOrder(
    tx: Prisma.TransactionClient,
    departmentId: string,
    triageQueueDate: Date,
  ): Promise<number> {
    const { _max } = await tx.triageQueueEntry.aggregate({
      where: { departmentId, triageQueueDate },
      _max: { queueOrder: true },
    });
    return (_max.queueOrder ?? 0) + 1;
  }

  /**
   * Round-robin: chọn y tá (StaffDepartment.actorRole = NURSE) thuộc đúng departmentId đang có
   * ÍT entry active nhất (waiting/called/in_progress) trong ngày, để chia đều tải giữa các y tá
   * cùng khoa. Không import ActorRoleService trực tiếp (tránh phụ thuộc chéo module không cần
   * thiết cho 1 lượt đọc đơn giản) — copy lại ngắn gọn đúng cách đọc actorRole của
   * ActorRoleService.getActorRole: ưu tiên userRoles[0].role.roleCode, fallback
   * profile.actorRole, .trim(), so với ACTOR_ROLE.NURSE.
   */
  private async assignNurse(
    tx: Prisma.TransactionClient,
    departmentId: string,
    triageQueueDate: Date,
  ): Promise<string> {
    const staffInDepartment = await tx.staffDepartment.findMany({
      where: { departmentId },
      include: {
        user: {
          include: {
            profile: true,
            userRoles: { include: { role: true } },
          },
        },
      },
    });

    const nurseUserIds = staffInDepartment
      .filter((staff) => {
        const actorRole = (
          staff.user.userRoles[0]?.role.roleCode ?? staff.user.profile?.actorRole
        )?.trim();
        return actorRole === ACTOR_ROLE.NURSE;
      })
      .map((staff) => staff.userId);

    if (nurseUserIds.length === 0) {
      throw new BadRequestException(
        `Khoa ${departmentId} chưa có y tá nào được gán (StaffDepartment) để nhận bệnh nhân triage`,
      );
    }

    let chosenNurseUserId = nurseUserIds[0];
    let lowestActiveCount = Infinity;

    for (const nurseUserId of nurseUserIds) {
      const activeCount = await tx.triageQueueEntry.count({
        where: {
          assignedNurseUserId: nurseUserId,
          status: { in: ACTIVE_TRIAGE_STATUSES },
          triageQueueDate,
        },
      });
      if (activeCount < lowestActiveCount) {
        lowestActiveCount = activeCount;
        chosenNurseUserId = nurseUserId;
      }
    }

    return chosenNurseUserId;
  }

  // GET /triage-queue?departmentId=&date=&status= — màn hình reception xem hàng đợi triage đã xếp.
  async findMany(query: { departmentId?: string; date?: string; status?: string }) {
    const where: Prisma.TriageQueueEntryWhereInput = {
      departmentId: query.departmentId,
      status: query.status,
    };
    if (query.date) {
      where.triageQueueDate = toDateOnlyUTC(new Date(query.date));
    }

    const entries = await this.prisma.triageQueueEntry.findMany({
      where,
      include: {
        encounter: { include: { patient: true, department: true } },
        assignedNurseUser: {
          select: {
            userId: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
      },
    });

    // Sắp theo đúng thứ tự ưu tiên: emergency lên đầu toàn khoa, cùng priority thì FIFO.
    return entries.sort(compareTriageQueueEntries);
  }

  async findById(queueEntryId: string) {
    const entry = await this.prisma.triageQueueEntry.findUnique({
      where: { queueEntryId },
      include: {
        encounter: { include: { patient: true, department: true } },
        assignedNurseUser: {
          select: {
            userId: true,
            email: true,
            profile: { select: { fullName: true } },
          },
        },
      },
    });
    if (!entry) {
      throw new NotFoundException('Không tìm thấy hàng đợi triage');
    }
    return entry;
  }
}
