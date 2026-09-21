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
import { UpdateEncounterDepartmentDto } from './dto/update-encounter-department.dto';

interface DoctorLoad {
  doctorId: string;
  load: number;
}

// Chỉ các trạng thái "chưa vào khám" mới được đổi khoa. in_progress/finished/cancelled thì không:
// bác sĩ đã bắt đầu khám hoặc lượt khám đã đóng, đổi khoa lúc đó sẽ làm sai hồ sơ.
const ROUTABLE_ENCOUNTER_STATUSES: string[] = [
  EncounterStatus.REGISTERED,
  EncounterStatus.WAITING_FOR_DOCTOR,
];

/**
 * Đổi khoa cho bệnh nhân SAU KHI đã có phiên đo sinh hiệu và CHƯA được đẩy vào hàng đợi bác sĩ, rồi xếp vào
 * hàng đợi (DoctorQueueEntry) của bác sĩ ÍT BỆNH NHÂN CHỜ NHẤT trong khoa mới; hoà tải thì chọn ngẫu nhiên đều.
 *
 * Toàn bộ chạy trong 1 transaction, chống race theo đúng pattern của QueueTicketService/TriageQueueService:
 *  (1) pg_advisory_xact_lock theo encounter  -> 2 request cùng 1 lượt khám không chạy song song;
 *  (2) pg_advisory_xact_lock theo (khoa mới, ngày) -> các request cùng đổ vào 1 khoa được xử lý TUẦN TỰ,
 *      nên mỗi request đọc tải bác sĩ CHÍNH XÁC (đã tính request trước) rồi mới ghi entry. Đây là điều
 *      kiện để "chia đều" thật sự đúng khi nhiều lễ tân/điều dưỡng thao tác cùng lúc — nếu không, 2 request
 *      cùng thấy bác sĩ A ít nhất và cùng xếp vào A.
 *  Lỗi P2002 (đụng unique [departmentId, doctorQueueDate, queueOrder]) được chuyển thành 409 thân thiện.
 *  KHÔNG retry trong cùng transaction như QueueTicketService: sau 1 lỗi SQL, Postgres đánh dấu transaction
 *  là aborted (25P02) nên mọi câu lệnh tiếp theo đều thất bại — vòng retry đó không có tác dụng.
 *
 * Ghi chú tải: đếm theo BÁC SĨ (mọi khoa bác sĩ đó đang nhận trong ngày), vì bác sĩ thuộc nhiều khoa vẫn chỉ
 * có 1 hàng người chờ thực tế. Khoá advisory theo khoa nên nếu 1 bác sĩ thuộc 2 khoa và 2 request đổ vào 2
 * khoa khác nhau cùng lúc thì độ lệch tối đa là 1 ca — chấp nhận được, đánh đổi lấy việc không khoá toàn cục.
 */
@Injectable()
export class EncounterDepartmentRoutingService {
  private readonly logger = new Logger(EncounterDepartmentRoutingService.name);

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

  async changeDepartment(encounterId: string, dto: UpdateEncounterDepartmentDto, currentUserId: string) {
    // Điều dưỡng (người vừa đo sinh hiệu) và lễ tân là người điều phối; ADMIN để xử lý sự cố.
    await this.actorRoleService.assertActorRole(currentUserId, [
      ACTOR_ROLE.NURSE,
      ACTOR_ROLE.RECEPTIONIST,
      ACTOR_ROLE.ADMIN,
    ]);

    try {
      // timeout mặc định của Prisma là 5s; DB ở xa thì ~10 câu lệnh có thể vượt (đã gặp thực tế ở seed).
      return await this.prisma.$transaction(
        (tx) => this.route(tx, encounterId, dto.departmentId, currentUserId),
        { maxWait: 10_000, timeout: 30_000 },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Hàng đợi của khoa vừa có thay đổi, vui lòng thử lại');
      }
      throw error;
    }
  }

  private async route(
    tx: Prisma.TransactionClient,
    encounterId: string,
    targetDepartmentId: string,
    currentUserId: string,
  ) {
    const wallNow = this.now();
    const today = toDateOnlyUTC(wallNow);

    // (1) Serialize theo lượt khám. Mọi kiểm tra trạng thái bên dưới phải đọc SAU khoá này.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`encounter-routing:${encounterId}`}))`;

    const encounter = await tx.encounter.findUnique({
      where: { encounterId },
      include: {
        appointment: { select: { priority: true } },
        doctorQueueEntry: true,
      },
    });
    if (!encounter) {
      throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
    }

    if (!ROUTABLE_ENCOUNTER_STATUSES.includes(encounter.status)) {
      throw new BadRequestException(
        `Lượt khám đang ở trạng thái '${encounter.status}', chỉ đổi khoa được khi đang '${ROUTABLE_ENCOUNTER_STATUSES.join("' hoặc '")}'.`,
      );
    }
    if (encounter.departmentId === targetDepartmentId) {
      throw new BadRequestException('Khoa mới trùng với khoa hiện tại của lượt khám.');
    }

    // Nghiệp vụ: chỉ đổi khoa SAU khi đã đo sinh hiệu (điều dưỡng cần số liệu để quyết định khoa phù hợp).
    const vitalSessionCount = await tx.vitalSignSession.count({ where: { encounterId } });
    if (vitalSessionCount === 0) {
      throw new BadRequestException('Lượt khám chưa có phiên ghi nhận sinh hiệu nào, chưa thể đổi khoa.');
    }

    const targetDepartment = await tx.department.findUnique({ where: { departmentId: targetDepartmentId } });
    if (!targetDepartment) {
      throw new NotFoundException(`Không tìm thấy khoa ${targetDepartmentId}`);
    }
    if (!targetDepartment.isActive) {
      throw new BadRequestException(`Khoa '${targetDepartment.departmentName}' hiện không hoạt động.`);
    }

    // Chỉ đổi khoa khi bệnh nhân CHƯA được đẩy vào hàng đợi bác sĩ. Đã có DoctorQueueEntry (dù trạng thái
    // nào: waiting/called/in_progress/done/skipped/cancelled) nghĩa là đã được điều phối cho 1 bác sĩ -> từ chối.
    if (encounter.doctorQueueEntry) {
      throw new BadRequestException(
        `Bệnh nhân đã được xếp vào hàng đợi bác sĩ (trạng thái '${encounter.doctorQueueEntry.status}'), không thể đổi khoa.`,
      );
    }

    // (2) Serialize theo (khoa mới, ngày): từ đây tới hết transaction, không ai khác đổ vào hàng đợi khoa này.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${doctorQueueLockKey(targetDepartmentId, today)}))`;

    const selection = await this.selectDoctor(tx, targetDepartmentId, today, wallNow);
    if (!selection) {
      // Ném TRƯỚC mọi thao tác ghi -> DB giữ nguyên, bệnh nhân vẫn ở khoa/bác sĩ cũ.
      throw new BadRequestException(
        `Khoa '${targetDepartment.departmentName}' hiện không có bác sĩ nào đang trong ca trực, chưa thể chuyển bệnh nhân sang khoa này.`,
      );
    }

    const queueOrder = await this.nextQueueOrder(tx, targetDepartmentId, today);
    const priority = encounter.appointment.priority;

    const entryData = {
      doctorId: selection.chosen.doctorId,
      departmentId: targetDepartmentId,
      queueOrder,
      priority,
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
        departmentId: targetDepartmentId,
        doctorId: selection.chosen.doctorId,
        status: nextStatus,
      },
    });

    // Giữ Appointment đồng bộ với Encounter (createFromCheckin sao chép departmentId/doctorId từ đây; các
    // màn hình/báo cáo theo khoa dựa trên Appointment). slotId và QueueTicket được GIỮ NGUYÊN: đó là bản ghi
    // lịch sử của lần đặt/bốc số ở khoa cũ, bệnh nhân đã check-in nên không còn giữ chỗ nào để trả lại.
    await tx.appointment.update({
      where: { appointmentId: encounter.appointmentId },
      data: { departmentId: targetDepartmentId, doctorId: selection.chosen.doctorId },
    });

    const doctor = await tx.doctor.findUniqueOrThrow({
      where: { doctorId: selection.chosen.doctorId },
      select: { doctorId: true, doctorCode: true, fullName: true, title: true },
    });

    // Chỉ log ID, không log dữ liệu lâm sàng.
    this.logger.log(
      `Encounter ${encounterId}: khoa ${encounter.departmentId} -> ${targetDepartmentId}, bác sĩ ${encounter.doctorId ?? 'null'} -> ${doctor.doctorId} ` +
      `(tải ${selection.chosen.load}, hoà ${selection.tiedCount}/${selection.candidates.length} người), queueOrder ${queueOrder}, bởi user ${currentUserId}`,
    );

    return {
      encounterId,
      previous: {
        departmentId: encounter.departmentId,
        doctorId: encounter.doctorId,
        encounterStatus: encounter.status,
      },
      current: {
        departmentId: targetDepartment.departmentId,
        departmentName: targetDepartment.departmentName,
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
   * Ứng viên = bác sĩ isActive thuộc khoa (DoctorDepartment) VÀ có ca trực status 'active' của đúng khoa đó,
   * hôm nay, mà thời điểm hiện tại nằm trong [startTime, endTime] — cùng điều kiện với
   * QueueTicketService.assertDoctorOnActiveShift.
   * Tải = số DoctorQueueEntry waiting/called/in_progress của bác sĩ trong ngày.
   */
  private async selectDoctor(
    tx: Prisma.TransactionClient,
    departmentId: string,
    today: Date,
    wallNow: Date,
  ) {
    const schedules = await tx.doctorSchedule.findMany({
      where: {
        departmentId,
        workDate: today,
        status: 'active',
        doctor: { isActive: true, doctorDepartments: { some: { departmentId } } },
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

  // queueOrder là số thứ tự theo KHOA/ngày (unique [departmentId, doctorQueueDate, queueOrder]), không theo bác sĩ.
  private async nextQueueOrder(tx: Prisma.TransactionClient, departmentId: string, doctorQueueDate: Date): Promise<number> {
    const { _max } = await tx.doctorQueueEntry.aggregate({
      where: { departmentId, doctorQueueDate },
      _max: { queueOrder: true },
    });
    return (_max.queueOrder ?? 0) + 1;
  }
}
