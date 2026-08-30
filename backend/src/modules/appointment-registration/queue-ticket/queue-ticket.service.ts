import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Appointment, Prisma, QueueTicket } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import {
  compareQueueTickets,
  QueueTicketPrefix,
  QueueTicketStatus,
  toDateOnlyUTC,
} from '../../../common/constants/queue-ticket.constants';
import {
  AppointmentStatus,
  isValidAppointmentTransition,
} from '../../../common/utils/appointment-status.util';
import { combineDateWithTimeOfDay } from '../../../common/utils/schedule-time.util';
import { EncounterService } from '../../reception-intake/encounter/encounter.service';
import { CallQueueTicketDto } from './dto/call-queue-ticket.dto';
import { ServeQueueTicketDto } from './dto/serve-queue-ticket.dto';
import { FindQueueTicketsQueryDto } from './dto/find-queue-tickets-query.dto';

@Injectable()
export class QueueTicketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly encounterService: EncounterService,
  ) {}

  /**
   * Sinh ticketNumber tiếp theo theo (departmentId, prefix, date) và tạo QueueTicket cho 1
   * appointment vừa tạo. PHẢI chạy trong cùng transaction với bước tạo Appointment (nhận `tx`
   * từ nơi gọi — xem AppointmentService.createAtHospital), 1 appointment at_hospital luôn đi
   * kèm đúng 1 ticket, không tách rời 2 bước (Phase 5).
   *
   * Chống race condition 2 lớp: (1) advisory lock theo key (departmentId, prefix, date) để
   * serialize các transaction cùng sinh số cho cùng 1 ngày/khoa/kênh; (2) bắt lỗi vi phạm unique
   * constraint DB ([departmentId, ticketPrefix, ticketDate, ticketNumber]) và retry 1 lần, phòng
   * trường hợp advisory lock không khả dụng (ví dụ chạy trên connection pooler không hỗ trợ).
   */
  async issueTicketForAppointment(
    tx: Prisma.TransactionClient,
    appointment: Appointment,
    prefix: QueueTicketPrefix,
  ): Promise<QueueTicket> {
    // Ticket luôn đại diện cho hàng đợi CỦA NGÀY BỆNH NHÂN THẬT SỰ CÓ MẶT tại khoa, không phải
    // ngày tạo appointment. Với at_hospital 2 mốc này trùng nhau (tạo lúc nào đến lúc đó) nên
    // trước đây dùng appointment.createdAt không lộ bug; với online thì appointment có thể được
    // TẠO/đặt trước nhiều ngày rồi mới đến, nên bắt buộc phải dùng ngày hiện tại tại đây.
    const ticketDate = toDateOnlyUTC(getHospitalWallClockNow());
    const lockKey = `${appointment.departmentId}:${prefix}:${ticketDate.toISOString().slice(0, 10)}`;

    // pg_advisory_xact_lock tự release khi transaction kết thúc (commit/rollback).
    //cái nào vào trc thì dùng trc, tạo ra 1 ổ khóa để cống race condition 
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const ticketNumber = await this.nextTicketNumber(tx, appointment.departmentId, prefix, ticketDate);

      try {
        return await tx.queueTicket.create({
          data: {
            appointmentId: appointment.appointmentId,
            departmentId: appointment.departmentId,
            ticketPrefix: prefix,
            ticketDate,
            ticketNumber,
            status: QueueTicketStatus.WAITING,
          },
        });
      } catch (error) {
        const isUniqueConflict =
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';// lỗi P2002 là trùng số trong prisma postgre
        if (!isUniqueConflict || attempt === 1) {// Lỗi này nếu không phải thử lại attempt=1 hoặc trùng số thì quăng lỗi ra, tránh chạy liên tụ gây nặng app
          throw error;
        }
        // Đụng unique constraint dù đã có advisory lock (hiếm) -> retry 1 lần với số mới.
      }
    }

    throw new BadRequestException('Không thể sinh số thứ tự hàng đợi, vui lòng thử lại');
  }
//Tìm số lớn nhất để biết thứ tự cấp là bao nhiêu(ví dụ đầu ngày chưa có ai thì null --> sẽ bắt đầu từ 1)
  private async nextTicketNumber(
    tx: Prisma.TransactionClient,
    departmentId: string,
    prefix: string,
    ticketDate: Date,
  ): Promise<number> {
    const { _max } = await tx.queueTicket.aggregate({
      where: { departmentId, ticketPrefix: prefix, ticketDate },
      _max: { ticketNumber: true },
    });
    return (_max.ticketNumber ?? 0) + 1;
  }

  // Chỉ cho phép `serve` với doctor đang có DoctorSchedule active, đúng khung giờ hiện tại, tại
  // đúng department của ticket — xem quyết định ở ServeQueueTicketDto / QueueTicketService.serve.
  private async assertDoctorOnActiveShift(doctorId: string, departmentId: string): Promise<void> {
    const now = getHospitalWallClockNow();
    const today = toDateOnlyUTC(now);

    const schedules = await this.prisma.doctorSchedule.findMany({
      where: { doctorId, departmentId, workDate: today, status: 'active' },
    });

    const isOnShift = schedules.some((schedule) => {
      const shiftStart = combineDateWithTimeOfDay(today, schedule.startTime);
      const shiftEnd = combineDateWithTimeOfDay(today, schedule.endTime);
      return now >= shiftStart && now <= shiftEnd;
    });

    if (!isOnShift) {
      throw new BadRequestException(
        'Bác sĩ không có ca làm việc (DoctorSchedule) đang active đúng khung giờ hiện tại tại khoa này',
      );
    }
  }

  async findById(ticketId: string) {
    const ticket = await this.prisma.queueTicket.findUnique({
      where: { ticketId },
      include: { appointment: true },
    });
    if (!ticket) {
      throw new NotFoundException('Không tìm thấy số thứ tự');
    }
    return ticket;
  }

  // GET /queue-tickets?departmentId=&date=&status= — màn hình hiển thị hàng đợi.
  async findMany(query: FindQueueTicketsQueryDto) {
    const where: Prisma.QueueTicketWhereInput = {
      departmentId: query.departmentId,
      status: query.status,
    };
    if (query.date) {
      where.ticketDate = toDateOnlyUTC(new Date(query.date));
    }

    const tickets = await this.prisma.queueTicket.findMany({
      where,
      include: { appointment: true },
    });

    // Sắp theo đúng thứ tự ưu tiên: online trước at_hospital, urgent lên đầu nhóm, FIFO nội bộ.
    return tickets.sort(compareQueueTickets);
  }

  // PATCH /queue-tickets/:id/call — chỉ reception staff.
  async call(ticketId: string, dto: CallQueueTicketDto) {
    const ticket = await this.findById(ticketId);
    if (ticket.status !== QueueTicketStatus.WAITING) {
      throw new BadRequestException(`Không thể gọi số đang ở trạng thái '${ticket.status}'`);
    }

    return this.prisma.queueTicket.update({
      where: { ticketId },
      data: {
        status: QueueTicketStatus.CALLED,
        calledAt: new Date(),
        counterNumber: dto.counterNumber,
      },
    });
  }

  // PATCH /queue-tickets/:id/serve — tạo ReceptionCheckin, gán doctorId, chuyển
  // Appointment.status = checked_in ĐÚNG QUA transition map dùng chung Phase 4 (không viết map riêng).
  async serve(ticketId: string, dto: ServeQueueTicketDto, currentUser: RequestUser) {
    const ticket = await this.findById(ticketId);
    if (![QueueTicketStatus.WAITING, QueueTicketStatus.CALLED].includes(ticket.status as QueueTicketStatus)) {
      throw new BadRequestException(`Không thể tiếp nhận số đang ở trạng thái '${ticket.status}'`);
    }

    // Online đã chọn bác sĩ cụ thể ngay từ lúc đặt lịch -> LUÔN ƯU TIÊN doctorId đã có sẵn trên
    // appointment, không cho lễ tân đổi tuỳ tiện tại bước serve (tránh gán nhầm/đổi khác ý bệnh
    // nhân đã chọn). Chỉ khi appointment chưa có doctorId (at_hospital, chưa từng chọn bác sĩ)
    // mới bắt buộc lễ tân cung cấp qua dto.doctorId.
    const doctorId = ticket.appointment.doctorId ?? dto.doctorId;
    if (!doctorId) {
      throw new BadRequestException(
        'Lịch hẹn này chưa gán bác sĩ, cần cung cấp doctorId khi tiếp nhận',
      );
    }

    const doctor = await this.prisma.doctor.findUnique({
      where: { doctorId },
      include: { doctorDepartments: true },
    });
    if (!doctor) {
      throw new NotFoundException('Không tìm thấy bác sĩ');
    }
    const belongsToDepartment = doctor.doctorDepartments.some(
      (dd) => dd.departmentId === ticket.departmentId,
    );
    if (!belongsToDepartment) {
      throw new BadRequestException('Bác sĩ không thuộc khoa của appointment này');
    }

    // Quyết định cho Câu hỏi mở #1 Phase 5: bác sĩ bắt buộc đang có DoctorSchedule active đúng
    // khung giờ hiện tại tại khoa này, không để lễ tân chọn tự do (tránh gán nhầm bác sĩ đã hết
    // ca/nghỉ, nhất quán với luồng online vốn đã validate slot theo đúng ca của bác sĩ).
    await this.assertDoctorOnActiveShift(doctorId, ticket.departmentId);

    return this.prisma.$transaction(async (tx) => {
      const updatedTicket = await tx.queueTicket.update({
        where: { ticketId },
        data: { status: QueueTicketStatus.SERVING },
      });

      await tx.receptionCheckin.create({
        data: {
          appointmentId: ticket.appointmentId,
          receptionStaffUserId: currentUser.userId,
          counterNumber: ticket.counterNumber,
        },
      });

      // pending -> confirmed -> checked_in, đi từng bước hợp lệ theo đúng map dùng chung
      // (at_hospital appointment không có bước "confirmed" riêng ở FE, nhưng vẫn phải qua đúng
      // state machine chung với Phase 4 chứ không nhảy thẳng pending -> checked_in).
      let currentStatus = ticket.appointment.status;
      for (const nextStatus of [AppointmentStatus.CONFIRMED, AppointmentStatus.CHECKED_IN]) {
        if (currentStatus === nextStatus) continue;
        if (!isValidAppointmentTransition(currentStatus, nextStatus)) {
          throw new BadRequestException(
            `Không thể chuyển Appointment từ '${currentStatus}' sang '${nextStatus}' theo transition map dùng chung`,
          );
        }
        currentStatus = nextStatus;
      }

      const updatedAppointment = await tx.appointment.update({
        where: { appointmentId: ticket.appointmentId },
        data: { doctorId, status: AppointmentStatus.CHECKED_IN },
      });

      return { queueTicket: updatedTicket, appointment: updatedAppointment };
    });
  }

  // PATCH /queue-tickets/:id/done — bàn giao Module 3: tạo Encounter trong cùng transaction với
  // bước đóng ticket, dùng ReceptionCheckin đã được tạo ở bước serve() để lấy đúng arrivedAt.
  async done(ticketId: string) {
    const ticket = await this.findById(ticketId);
    if (ticket.status !== QueueTicketStatus.SERVING) {
      throw new BadRequestException(`Không thể đánh dấu hoàn tất khi đang ở trạng thái '${ticket.status}'`);
    }

    // serve() luôn tạo đúng 1 ReceptionCheckin cho appointment trước khi ticket chuyển sang
    // SERVING, nên tại đây bắt buộc phải tìm thấy — nếu không có nghĩa là dữ liệu bất thường.
    const checkin = await this.prisma.receptionCheckin.findFirst({
      where: { appointmentId: ticket.appointmentId },
      orderBy: { checkinTime: 'desc' },
    });
    if (!checkin) {
      throw new BadRequestException(
        'Không tìm thấy ReceptionCheckin của appointment này, không thể tạo Encounter',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedTicket = await tx.queueTicket.update({
        where: { ticketId },
        data: { status: QueueTicketStatus.DONE },
      });

      const encounter = await this.encounterService.createFromCheckin(tx, ticket.appointment, checkin);

      return { queueTicket: updatedTicket, encounter };
    });
  }
}

function getHospitalWallClockNow(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));

  return new Date(
    Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second),
  );
}