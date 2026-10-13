import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomInt } from 'crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import {
  ACTIVE_DOCTOR_QUEUE_STATUSES,
  DoctorQueueStatus,
  doctorQueueLockKey,
} from '../../../common/constants/doctor-queue.constants';
import { toDateOnlyUTC } from '../../../common/constants/queue-ticket.constants';
import { EncounterStatus, isValidEncounterTransition } from '../../../common/utils/encounter-status.util';
import { getHospitalWallClockNow } from '../../../common/utils/hospital-clock.util';
import { pickLeastLoaded } from '../../../common/utils/least-loaded.util';
import { combineDateWithTimeOfDay } from '../../../common/utils/schedule-time.util';
import { ActorRoleService } from '../../user/actor-role.service';

interface DoctorLoad {
  doctorId: string;
  load: number;
}

// Chỉ các trạng thái "chưa vào khám" mới được điều phối vào hàng đợi bác sĩ.
const ROUTABLE_ENCOUNTER_STATUSES: string[] = [
  EncounterStatus.REGISTERED,
  EncounterStatus.WAITING_FOR_DOCTOR,
];

/**
 * Schema v2 chỉ có 1 chuyên khoa (Tim mạch) nên không còn "đổi khoa"; việc còn lại là điều phối bệnh nhân SAU KHI
 * đã có phiên đo sinh hiệu và CHƯA vào hàng đợi bác sĩ: xếp vào hàng đợi (DoctorQueueEntry) của bác sĩ ĐANG TRONG CA
 * có ÍT BỆNH NHÂN CHỜ NHẤT; hoà tải thì chọn ngẫu nhiên đều.
 *
 * Toàn bộ chạy trong 1 transaction, chống race theo pattern của QueueTicketService/TriageQueueService:
 *  (1) pg_advisory_xact_lock theo encounter -> 2 request cùng 1 lượt khám không chạy song song;
 *  (2) pg_advisory_xact_lock theo ngày (hàng đợi bác sĩ chung của phòng khám) -> các request được xử lý TUẦN TỰ,
 *      nên mỗi request đọc tải bác sĩ chính xác rồi mới ghi entry.
 *  Lỗi P2002 (đụng unique [doctorId, doctorQueueDate, queueOrder]) được chuyển thành 409 thân thiện.
 *  KHÔNG retry trong cùng transaction: sau 1 lỗi SQL, Postgres đánh dấu transaction là aborted (25P02).
 */
@Injectable()
export class EncounterDoctorRoutingService {
  private readonly logger = new Logger(EncounterDoctorRoutingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly actorRoleService: ActorRoleService,
  ) { }

  // Tách ra để test kiểm soát được "bây giờ" và nguồn ngẫu nhiên.
  protected now(): Date {
    return getHospitalWallClockNow();
  }

  protected randomIndex(upperExclusive: number): number {
    return randomInt(upperExclusive);
  }

  async routeToDoctor(encounterId: string, currentUserId: string) {
    // Điều dưỡng (người vừa đo sinh hiệu) và lễ tân là người điều phối; ADMIN để xử lý sự cố.
    await this.actorRoleService.assertActorRole(currentUserId, [
      ACTOR_ROLE.NURSE,
      ACTOR_ROLE.RECEPTIONIST,
      ACTOR_ROLE.ADMIN,
    ]);

    try {
      // timeout mặc định của Prisma là 5s; DB ở xa thì ~10 câu lệnh có thể vượt (đã gặp thực tế ở seed).
      return await this.prisma.$transaction(
        (tx) => this.route(tx, encounterId, currentUserId),
        { maxWait: 10_000, timeout: 30_000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Hàng đợi bác sĩ vừa có thay đổi, vui lòng thử lại');
      }
      throw error;
    }
  }

  private async route(
    tx: Prisma.TransactionClient,
    encounterId: string,
    currentUserId: string,
  ) {
    const wallNow = this.now();
    const today = toDateOnlyUTC(wallNow);

    // (1) Serialize theo lượt khám. Mọi kiểm tra trạng thái bên dưới phải đọc SAU khoá này.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`encounter-routing:${encounterId}`}))`;

    const encounter = await tx.encounter.findUnique({
      where: { encounterId },
      include: {
        appointment: { select: { priority: true, bookingChannel: true } },
        doctorQueueEntry: true,
      },
    });
    if (!encounter) {
      throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
    }

    if (!ROUTABLE_ENCOUNTER_STATUSES.includes(encounter.status)) {
      throw new BadRequestException(
        `Lượt khám đang ở trạng thái '${encounter.status}', chỉ điều phối được khi đang '${ROUTABLE_ENCOUNTER_STATUSES.join("' hoặc '")}'.`,
      );
    }

    // Nghiệp vụ: chỉ điều phối SAU khi đã đo sinh hiệu.
    const vitalSessionCount = await tx.vitalSignSession.count({ where: { encounterId } });
    if (vitalSessionCount === 0) {
      throw new BadRequestException('Lượt khám chưa có phiên ghi nhận sinh hiệu nào, chưa thể điều phối vào hàng đợi bác sĩ.');
    }

    // Chỉ điều phối khi bệnh nhân CHƯA vào hàng đợi bác sĩ. Đã có DoctorQueueEntry (dù trạng thái nào)
    // nghĩa là đã được điều phối cho 1 bác sĩ -> từ chối.
    if (encounter.doctorQueueEntry) {
      throw new BadRequestException(
        `Bệnh nhân đã được xếp vào hàng đợi bác sĩ (trạng thái '${encounter.doctorQueueEntry.status}'), không thể điều phối lại.`,
      );
    }

    // (2) Serialize theo ngày: từ đây tới hết transaction, không ai khác đổ vào hàng đợi bác sĩ của ngày này.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctorQueueLockKey(today)}))`;

    const selection = await this.selectDoctor(tx, today, wallNow);
    if (!selection) {
      // Ném TRƯỚC mọi thao tác ghi -> DB giữ nguyên.
      throw new BadRequestException(
        'Hiện không có bác sĩ nào đang trong ca trực, chưa thể xếp bệnh nhân vào hàng đợi.',
      );
    }

    const queueOrder = await this.nextQueueOrder(tx, selection.chosen.doctorId, today);
    const priority = encounter.appointment.priority;

    const entryData = {
      doctorId: selection.chosen.doctorId,
      queueOrder,
      priority,
      // copy từ appointment để sắp xếp ưu tiên: online | walk_in (doctor_follow_up coi như online — đã đặt lịch trước)
      intakeChannel: encounter.appointment.bookingChannel === 'walk_in' ? 'walk_in' : 'online',
      status: DoctorQueueStatus.WAITING,
      doctorQueueDate: today,
      enteredQueueAt: new Date(),
      routedByUserId: currentUserId,
    };

    const queueEntry = await tx.doctorQueueEntry.create({ data: { encounterId, ...entryData } });

    // Vào hàng đợi bác sĩ = đang chờ bác sĩ. Khớp precondition của ClinicalExaminationService.upsert
    // (chỉ nhận waiting_for_doctor / in_progress) nên bác sĩ khám được ngay.
    let nextStatus = encounter.status;
    if (encounter.status === EncounterStatus.REGISTERED) {
      if (!isValidEncounterTransition(encounter.status, EncounterStatus.WAITING_FOR_DOCTOR)) {
        throw new BadRequestException('Không thể chuyển lượt khám sang waiting_for_doctor');
      }
      nextStatus = EncounterStatus.WAITING_FOR_DOCTOR;
    }

    await tx.encounter.update({
      where: { encounterId },
      data: {
        doctorId: selection.chosen.doctorId,
        status: nextStatus,
      },
    });

    // Giữ Appointment đồng bộ với Encounter (createFromCheckin sao chép doctorId từ đây). slotId và QueueTicket
    // được GIỮ NGUYÊN: đó là bản ghi lịch sử của lần đặt/bốc số, bệnh nhân đã check-in nên không còn chỗ nào để trả lại.
    await tx.appointment.update({
      where: { appointmentId: encounter.appointmentId },
      data: { doctorId: selection.chosen.doctorId },
    });

    const doctor = await tx.doctor.findUniqueOrThrow({
      where: { doctorId: selection.chosen.doctorId },
      select: { doctorId: true, doctorCode: true, fullName: true, title: true },
    });

    // Chỉ log ID, không log dữ liệu lâm sàng.
    this.logger.log(
      `Encounter ${encounterId}: bác sĩ ${encounter.doctorId ?? 'null'} -> ${doctor.doctorId} ` +
      `(tải ${selection.chosen.load}, hoà ${selection.tiedCount}/${selection.candidates.length} người), queueOrder ${queueOrder}, bởi user ${currentUserId}`,
    );

    return {
      encounterId,
      previous: {
        doctorId: encounter.doctorId,
        encounterStatus: encounter.status,
      },
      current: {
        doctor,
        encounterStatus: nextStatus,
      },
      queueEntry,
      // Minh bạch để kiểm chứng cân bằng tải: tải từng ứng viên TRƯỚC khi xếp bệnh nhân này.
      assignment: {
        strategy: 'least-loaded-random-tiebreak',
        queueLoadBefore: selection.chosen.load,
        tiedCandidates: selection.tiedCount,
        candidates: selection.candidates,
      },
    };
  }

  /**
   * Ứng viên = bác sĩ isActive có ca trực status 'active' hôm nay mà thời điểm hiện tại nằm trong
   * [startTime, endTime] — cùng điều kiện với QueueTicketService.assertDoctorOnActiveShift.
   * Tải = số DoctorQueueEntry waiting/called/in_progress của bác sĩ trong ngày.
   */
  private async selectDoctor(
    tx: Prisma.TransactionClient,
    today: Date,
    wallNow: Date,
  ) {
    const schedules = await tx.doctorSchedule.findMany({
      where: {
        workDate: today,
        status: 'active',
        doctor: { isActive: true },
      },
      select: { doctorId: true, workDate: true, startTime: true, endTime: true },
    });

    const onShiftDoctorIds = [
      ...new Set(
        schedules
          .filter((s) => {
            const start = combineDateWithTimeOfDay(s.workDate, s.startTime);
            const end = combineDateWithTimeOfDay(s.workDate, s.endTime);
            return wallNow >= start && wallNow <= end;
          })
          .map((s) => s.doctorId),
      ),
    ].sort(); // sort để kết quả không phụ thuộc thứ tự DB trả về (dễ test, dễ tái lập)

    if (onShiftDoctorIds.length === 0) return null;

    const grouped = await tx.doctorQueueEntry.groupBy({
      by: ['doctorId'],
      where: {
        doctorId: { in: onShiftDoctorIds },
        doctorQueueDate: today,
        status: { in: ACTIVE_DOCTOR_QUEUE_STATUSES },
      },
      _count: { _all: true },
    });
    const loadByDoctor = new Map(grouped.map((g) => [g.doctorId, g._count._all]));

    const candidates: DoctorLoad[] = onShiftDoctorIds.map((doctorId) => ({
      doctorId,
      load: loadByDoctor.get(doctorId) ?? 0,
    }));

    const picked = pickLeastLoaded(candidates, (n) => this.randomIndex(n));
    if (!picked) return null;
    return { chosen: picked.chosen, tiedCount: picked.tiedCount, candidates };
  }

  // queueOrder là số thứ tự theo BÁC SĨ/ngày (unique [doctorId, doctorQueueDate, queueOrder]).
  private async nextQueueOrder(tx: Prisma.TransactionClient, doctorId: string, doctorQueueDate: Date): Promise<number> {
    const agg = await tx.doctorQueueEntry.aggregate({
      where: { doctorId, doctorQueueDate },
      _max: { queueOrder: true },
    });
    return (agg._max?.queueOrder ?? 0) + 1;
  }
}
