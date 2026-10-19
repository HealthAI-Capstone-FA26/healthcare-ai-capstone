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
import { generateUniqueCode } from '../../../common/utils/code-generator.util';
import { getHospitalWallClockNow } from '../../../common/utils/hospital-clock.util';
import { InvoiceService } from '../../payment/invoice/invoice.service';
import { PatientService } from '../patient/patient.service';
import { CallQueueTicketDto } from './dto/call-queue-ticket.dto';
import { ServeQueueTicketDto } from './dto/serve-queue-ticket.dto';
import { FindQueueTicketsQueryDto } from './dto/find-queue-tickets-query.dto';

@Injectable()
export class QueueTicketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientService: PatientService, // [MỚI] tạo hồ sơ BN at-hospital ngay lúc done()
    private readonly invoiceService: InvoiceService, // lập hoá đơn phí khám trước khi tạo encounter
  ) {}

  // [MỚI] Mã lịch hẹn cho appointment walk_in tạo ngầm ở done() (cùng prefix 'LH' với AppointmentService).
  // Không inject AppointmentService vì nó đã inject QueueTicketService -> vòng phụ thuộc.
  private generateAppointmentCode(): Promise<string> {
    return generateUniqueCode('LH', async (code) => {
      const existing = await this.prisma.appointment.findUnique({ where: { appointmentCode: code } });
      return Boolean(existing);
    });
  }

  /**
   * Sinh ticketNumber tiếp theo theo (prefix, date) và tạo QueueTicket cho 1
   * appointment vừa tạo. PHẢI chạy trong cùng transaction với bước tạo Appointment (nhận `tx`
   * từ nơi gọi — xem AppointmentService.createAtHospital), 1 appointment at_hospital luôn đi
   * kèm đúng 1 ticket, không tách rời 2 bước (Phase 5).
   *
   * Chống race condition 2 lớp: (1) advisory lock theo key (prefix, date) để
   * serialize các transaction cùng sinh số cho cùng 1 ngày/kênh; (2) bắt lỗi vi phạm unique
   * constraint DB ([ticketPrefix, ticketDate, ticketNumber]) và retry 1 lần, phòng
   * trường hợp advisory lock không khả dụng (ví dụ chạy trên connection pooler không hỗ trợ).
   */
  async issueTicketForAppointment(
    tx: Prisma.TransactionClient,
    appointment: Appointment,
    prefix: QueueTicketPrefix,
  ): Promise<QueueTicket> {
    return this.createTicket(tx, prefix, appointment.appointmentId);
  }

  // [MỚI] Bốc số at-hospital (prefix B): bệnh nhân chưa có hồ sơ/appointment gì cả, ticket chỉ giữ chỗ
  // trong hàng đợi (appointmentId = null). Appointment walk_in + patient được tạo ngầm ở done().
  async issueWalkInTicket(): Promise<QueueTicket> {
    return this.prisma.$transaction((tx) => this.createTicket(tx, QueueTicketPrefix.AT_HOSPITAL, null));
  }

  // Phần sinh số + chống race giữ nguyên như cũ, chỉ khác appointmentId có thể null (walk-in).
  private async createTicket(
    tx: Prisma.TransactionClient,
    prefix: QueueTicketPrefix,
    appointmentId: string | null,
  ): Promise<QueueTicket> {
    // Ticket luôn đại diện cho hàng đợi CỦA NGÀY BỆNH NHÂN THẬT SỰ CÓ MẶT tại khoa, không phải
    // ngày tạo appointment. Với at_hospital 2 mốc này trùng nhau (tạo lúc nào đến lúc đó) nên
    // trước đây dùng appointment.createdAt không lộ bug; với online thì appointment có thể được
    // TẠO/đặt trước nhiều ngày rồi mới đến, nên bắt buộc phải dùng ngày hiện tại tại đây.
    const ticketDate = toDateOnlyUTC(getHospitalWallClockNow());
    const lockKey = `queue-ticket:${prefix}:${ticketDate.toISOString().slice(0, 10)}`;

    // pg_advisory_xact_lock tự release khi transaction kết thúc (commit/rollback).
    //cái nào vào trc thì dùng trc, tạo ra 1 ổ khóa để cống race condition 
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const ticketNumber = await this.nextTicketNumber(tx, prefix, ticketDate);

      try {
        return await tx.queueTicket.create({
          data: {
            appointmentId,
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
    prefix: string,
    ticketDate: Date,
  ): Promise<number> {
    const agg = await tx.queueTicket.aggregate({
      where: { ticketPrefix: prefix, ticketDate },
      _max: { ticketNumber: true },
    });
    return (agg._max?.ticketNumber ?? 0) + 1;
  }

  // Chỉ cho phép `serve` với doctor đang có DoctorSchedule active, đúng khung giờ hiện tại — xem quyết định ở ServeQueueTicketDto / QueueTicketService.serve.
  private async assertDoctorOnActiveShift(doctorId: string): Promise<void> {
    const now = getHospitalWallClockNow();
    const today = toDateOnlyUTC(now);

    const schedules = await this.prisma.doctorSchedule.findMany({
      where: { doctorId, workDate: today, status: 'active' },
    });

    const isOnShift = schedules.some((schedule) => {
      const shiftStart = combineDateWithTimeOfDay(today, schedule.startTime);
      const shiftEnd = combineDateWithTimeOfDay(today, schedule.endTime);
      return now >= shiftStart && now <= shiftEnd;
    });

    if (!isOnShift) {
      throw new BadRequestException(
        'Bác sĩ không có ca làm việc (DoctorSchedule) đang active đúng khung giờ hiện tại',
      );
    }
  }

  async findById(ticketId: string) {
    const ticket = await this.prisma.queueTicket.findUnique({
      where: { ticketId },
      include: {
        appointment: {
          include: {
            patient: true,
            doctor: {
              include: { user: true },
            },
            slot: true,
          },
        },
      },
    });
    if (!ticket) {
      throw new NotFoundException('Không tìm thấy số thứ tự');
    }
    return ticket;
  }

  // GET /queue-tickets?date=&status= — màn hình hiển thị hàng đợi.
  async findMany(query: FindQueueTicketsQueryDto) {
    const where: Prisma.QueueTicketWhereInput = {
      status: query.status,
    };
    if (query.date) {
      where.ticketDate = toDateOnlyUTC(new Date(query.date));
    }

    const tickets = await this.prisma.queueTicket.findMany({
      where,
      include: {
        appointment: {
          include: {
            patient: true,
            doctor: {
              include: { user: true },
            },
            slot: true,
            encounter: {
              select: { encounterId: true, encounterCode: true },
            },
          },
        },
      },
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

  // PATCH /queue-tickets/:id/done — kết thúc lượt gọi số (called -> done), tạo Appointment
  // walk_in nếu cần và lập invoice phí khám pending. Encounter chỉ được tạo sau khi invoice
  // examination fee đã paid qua API riêng.
  //
  // 2 nhánh:
  //  - ONLINE (ticket đã gắn appointment): như cũ.
  //  - AT-HOSPITAL (ticket bốc trước, appointmentId = null): lễ tân nhập thông tin bệnh nhân
  //    (patientId có sẵn HOẶC patient mới) -> tạo ngầm patient (nếu mới) + appointment walk_in, gắn vào
  //    ticket, rồi lập invoice phí khám pending.
  async done(ticketId: string, dto: ServeQueueTicketDto, currentUser: RequestUser) {
    const ticket = await this.findById(ticketId);
    if (ticket.status !== QueueTicketStatus.CALLED) {
      throw new BadRequestException(`Không thể chuyển sang khám khi đang ở trạng thái '${ticket.status}'`);
    }

    const appointment = ticket.appointment;
    const isWalkIn = !appointment; // ticket at-hospital chưa gắn appointment

    if (isWalkIn) {
      // Nhánh at-hospital: bắt buộc có thông tin bệnh nhân để tạo appointment ngầm.
      if (!dto.patientId && !dto.patient) {
        throw new BadRequestException(
          'Cần cung cấp patientId (bệnh nhân đã có hồ sơ) hoặc patient (thông tin bệnh nhân mới) để tiếp nhận số thứ tự at-hospital',
        );
      }
      if (dto.patientId && dto.patient) {
        throw new BadRequestException('Chỉ được cung cấp một trong patientId hoặc patient');
      }
    } else if (!appointment.patientId) {
      // Appointment ở case "matched nhưng chưa xác nhận" (guest booking) có patientId = null cho tới
      // khi lễ tân đối chiếu qua POST /appointment/sync-patient. Chặn sớm ở đây.
      throw new BadRequestException(
        'Lịch hẹn chưa xác nhận hồ sơ bệnh nhân, vui lòng đồng bộ (sync-patient) trước khi check-in',
      );
    }

    // Online đã chọn bác sĩ từ lúc đặt lịch -> LUÔN ƯU TIÊN doctorId trên appointment. Walk-in chưa có
    // appointment nên bắt buộc lễ tân cung cấp qua dto.doctorId.
    const doctorId = appointment?.doctorId ?? dto.doctorId;
    if (!doctorId) {
      throw new BadRequestException(
        'Lịch hẹn này chưa gán bác sĩ, cần cung cấp doctorId khi tiếp nhận',
      );
    }

    const doctor = await this.prisma.doctor.findUnique({ where: { doctorId } });
    if (!doctor) {
      throw new NotFoundException('Không tìm thấy bác sĩ');
    }

    // Bác sĩ bắt buộc đang có DoctorSchedule active đúng khung giờ hiện tại (Câu hỏi mở #1 Phase 5).
    await this.assertDoctorOnActiveShift(doctorId);

    // Sinh mã ngoài transaction (giống cách AppointmentService làm), chỉ cần cho nhánh walk-in.
    const appointmentCode = isWalkIn ? await this.generateAppointmentCode() : null;

    const result = await this.prisma.$transaction(async (tx) => {
      let currentAppointment: Appointment | null = appointment;

      if (!currentAppointment) {
        // [MỚI] Tạo ngầm patient (nếu là BN mới) + appointment walk_in trong cùng transaction với done.
        let patientId = dto.patientId;
        if (patientId) {
          const existing = await tx.patient.findUnique({ where: { patientId } });
          if (!existing) {
            throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');
          }
        } else {
          patientId = (await this.patientService.createMainPatientRecord(dto.patient!, tx)).patientId;
        }

        currentAppointment = await tx.appointment.create({
          data: {
            appointmentCode: appointmentCode!,
            bookingChannel: 'walk_in',
            status: AppointmentStatus.PENDING,
            patientId,
            doctorId,
            slotId: null,
            bookedByUserId: currentUser.userId,
            appointmentDate: toDateOnlyUTC(getHospitalWallClockNow()),
            appointmentTime: null,
            reasonForVisit: dto.reasonForVisit ?? dto.symptoms,
            priority: dto.priority,
          },
        });
      }

      // called -> done: ticket hoàn tất vai trò hàng đợi/ưu tiên ngay tại đây, KHÔNG có trạng
      // thái trung gian "serving" nào cả. Guard status=CALLED ngay trong where để 2 lễ tân bấm done
      // cùng lúc thì request đến sau bị từ chối (P2025), không tạo trùng appointment/encounter.
      // appointmentId được gắn vào ticket ở đây (với walk-in là lần đầu tiên có giá trị).
      const updatedTicket = await tx.queueTicket
        .update({
          where: { ticketId, status: QueueTicketStatus.CALLED },
          data: { status: QueueTicketStatus.DONE, appointmentId: currentAppointment.appointmentId },
        })
        .catch((error) => {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            throw new BadRequestException(
              "Số thứ tự vừa được tiếp nhận bởi thao tác khác (không còn ở trạng thái 'called')",
            );
          }
          throw error;
        });

      // Lưu mốc tiếp nhận để dùng khi tạo Encounter sau khi invoice được thanh toán.
      await tx.receptionCheckin.create({
        data: {
          appointmentId: currentAppointment.appointmentId,
          receptionStaffUserId: currentUser.userId,
          counterNumber: ticket.counterNumber,
        },
      });

      // pending -> confirmed. Appointment chỉ chuyển sang checked_in khi tạo Encounter sau thanh toán.
      let currentStatus = currentAppointment.status;
      for (const nextStatus of [AppointmentStatus.CONFIRMED]) {
        if (currentStatus === nextStatus) continue;
        if (!isValidAppointmentTransition(currentStatus, nextStatus)) {
          throw new BadRequestException(
            `Không thể chuyển Appointment từ '${currentStatus}' sang '${nextStatus}' theo transition map dùng chung`,
          );
        }
        currentStatus = nextStatus;
      }

      const updatedAppointment = await tx.appointment.update({
        where: { appointmentId: currentAppointment.appointmentId },
        data: { doctorId, status: AppointmentStatus.CONFIRMED },
      });

      return { queueTicket: updatedTicket, appointment: updatedAppointment };
    });

    const invoice = await this.invoiceService.generate({
      appointmentId: result.appointment.appointmentId,
    });

    return { ...result, invoice };
  }
}
