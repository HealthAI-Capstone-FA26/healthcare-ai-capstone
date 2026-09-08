import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { generateUniqueCode } from '../../../common/utils/code-generator.util';
import {
  AppointmentStatus,
  canCancelAppointment,
  isValidAppointmentTransition,
} from '../../../common/utils/appointment-status.util';
import { RelationshipType } from '../../../common/constants/relationship.constants';
import { isPendingRelationship } from '../../../common/constants/patient-contact.constants';
import { PatientContactService } from '../patientContact/patient-contact.service';
import { QueueTicketService } from '../queue-ticket/queue-ticket.service';
import { QueueTicketPrefix } from '../../../common/constants/queue-ticket.constants';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { hasPermissionScope } from '../../../common/utils/permission.util';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { CreateAtHospitalAppointmentDto } from './dto/create-at-hospital-appointment.dto';
import { FindAppointmentsQueryDto } from './dto/find-appointments-query.dto';
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';

const APPOINTMENT_CODE_PREFIX = 'LH';

@Injectable()
export class AppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientContactService: PatientContactService,
    private readonly queueTicketService: QueueTicketService,
  ) { }

  private generateAppointmentCode(): Promise<string> {
    return generateUniqueCode(APPOINTMENT_CODE_PREFIX, async (code) => {
      const existing = await this.prisma.appointment.findUnique({
        where: { appointmentCode: code },
      });
      return Boolean(existing);
    });
  }

  // POST /appointments (bookingChannel = online)
  // POST /appointments (bookingChannel = online)
  async createOnline(dto: CreateAppointmentDto, currentUser: RequestUser) {
    // 1. patientId tồn tại.
    const patient = await this.prisma.patient.findUnique({ where: { patientId: dto.patientId } });
    if (!patient) {
      throw new NotFoundException('Hồ sơ bệnh nhân bạn cần tìm không tồn tại. Hãy tạo hồ sơ trước khi đặt lịch');
    }

    // 2. Bắt buộc đã có PatientContact "sạch" (đã duyệt) từ trước giữa currentUser và patient này.
    // Việc TẠO contact (self lúc tạo hồ sơ/link-user, hoặc người thân qua contact-request) được xử
    // lý riêng ở PatientService/PatientContactService — createOnline KHÔNG tự tạo/upsert contact nữa,
    // chỉ đọc và xác thực contact đã tồn tại.
    const existingContact = await this.prisma.patientContact.findUnique({
      where: { userId_patientId: { userId: currentUser.userId, patientId: dto.patientId } },
    });

    if (!existingContact || isPendingRelationship(existingContact.relationship)) {
      throw new ForbiddenException(
        'Bạn chưa có liên kết hợp lệ với hồ sơ bệnh nhân này. Vui lòng liên kết hồ sơ (nếu là bản thân) ' +
        'hoặc gửi yêu cầu làm người liên hệ và chờ chủ hồ sơ duyệt trước khi đặt lịch.',
      );
    }

    // relationship trong dto (nếu có) phải khớp với contact đã duyệt — tránh client tự khai khác đi.
    if (dto.relationship && dto.relationship !== existingContact.relationship) {
      throw new BadRequestException(
        `relationship trong yêu cầu ('${dto.relationship}') không khớp với liên kết đã duyệt ('${existingContact.relationship}')`,
      );
    }

    // 3. AppointmentSlot tồn tại, thuộc đúng doctorId, status = free.
    const slot = await this.prisma.appointmentSlot.findUnique({
      where: { slotId: dto.slotId },
      include: { schedule: true },
    });
    if (!slot || slot.schedule.doctorId !== dto.doctorId || slot.status !== 'free') {
      throw new BadRequestException('Slot không tồn tại, không thuộc bác sĩ này, hoặc đã hết chỗ');
    }

    if (slot.schedule.departmentId !== dto.departmentId) {
      throw new BadRequestException('Slot không thuộc khoa đã chọn');
    }

    const appointmentCode = await this.generateAppointmentCode();

    return this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          appointmentCode,
          bookingChannel: 'online',
          status: AppointmentStatus.PENDING,
          patientId: dto.patientId,
          doctorId: dto.doctorId,
          departmentId: dto.departmentId,
          slotId: dto.slotId,
          bookedByUserId: currentUser.userId,
          appointmentDate: slot.slotStartTime,
          appointmentTime: slot.slotStartTime,
          reasonForVisit: dto.reasonForVisit,
          priority: dto.priority,
        },
      });

      const slotUpdateResult = await tx.appointmentSlot.updateMany({
        where: { slotId: dto.slotId, bookedCount: { lt: slot.capacity } },
        data: { bookedCount: { increment: 1 } },
      });
      if (slotUpdateResult.count === 0) {
        throw new ConflictException('Slot đã đầy, vui lòng chọn slot khác');
      }

      const newBookedCount = slot.bookedCount + 1;
      if (newBookedCount >= slot.capacity) {
        await tx.appointmentSlot.update({
          where: { slotId: dto.slotId },
          data: { status: 'full' },
        });
      }

      return appointment;
    });
  }

  // POST /appointments/at-hospital (bookingChannel = at_hospital) — chỉ reception staff.
  // Luôn tạo kèm đúng 1 QueueTicket (prefix B) trong CÙNG transaction, không tách rời 2 bước (Phase 5).
  async createAtHospital(dto: CreateAtHospitalAppointmentDto, currentUser: RequestUser) {
    let patientId = dto.patientId;

    if (!patientId) {
      throw new BadRequestException('Cần cung cấp patientId');
    }

    const patient = await this.prisma.patient.findUnique({ where: { patientId } });
    if (!patient) {
      throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');
    }

    const department = await this.prisma.department.findUnique({
      where: { departmentId: dto.departmentId },
    });
    if (!department) {
      throw new NotFoundException('Không tìm thấy khoa');
    }

    const appointmentCode = await this.generateAppointmentCode();
    const today = new Date(new Date().toDateString());

    return this.prisma.$transaction(async (tx) => {
      const appointment = await tx.appointment.create({
        data: {
          appointmentCode,
          bookingChannel: 'at_hospital',
          status: AppointmentStatus.PENDING,
          patientId,
          doctorId: null,
          departmentId: dto.departmentId,
          slotId: null,
          bookedByUserId: currentUser.userId,
          appointmentDate: today,
          reasonForVisit: dto.reasonForVisit,
          priority: dto.priority,
        },
      });

      const queueTicket = await this.queueTicketService.issueTicketForAppointment(
        tx,
        appointment,
        QueueTicketPrefix.AT_HOSPITAL,
      );

      return { appointment, queueTicket };
    });
  }

  async findById(appointmentId: string) {
    const appointment = await this.prisma.appointment.findUnique({
      where: { appointmentId },
      include: {
        patient: true,
        doctor: {
          include: {
            user: true,
          },
        },
        department: true,
        slot: true,
        queueTicket: true,
      },
    });
    if (!appointment) {
      throw new NotFoundException('Không tìm thấy lịch hẹn');
    }
    return appointment;
  }

  // GET /appointments?patientId=&status=&from=&to=
  async findMany(query: FindAppointmentsQueryDto, currentUser?: RequestUser) {
    // Chỉ người dùng có quyền đọc lịch hẹn phạm vi ALL hoặc GROUP (Lễ tân, Bác sĩ, Admin) mới được xem lịch toàn viện
    const isStaff =
      currentUser &&
      (hasPermissionScope(
        currentUser.permissions,
        Resource.APPOINTMENT,
        Action.READ,
        Scope.ALL,
      ) ||
        hasPermissionScope(
          currentUser.permissions,
          Resource.APPOINTMENT,
          Action.READ,
          Scope.GROUP,
        ));

    const where: Prisma.AppointmentWhereInput = {
      patientId: query.patientId,
      status: query.status,
    };

    // Nếu là bệnh nhân (không phải Staff/Admin xem tất cả), chỉ lấy lịch hẹn do user này đặt hoặc thuộc hồ sơ của user
    if (!isStaff && currentUser) {
      const myContacts = await this.prisma.patientContact.findMany({
        where: { userId: currentUser.userId },
        select: { patientId: true },
      });
      const myPatientIds = myContacts.map((c) => c.patientId);

      where.OR = [
        { bookedByUserId: currentUser.userId },
        { patientId: { in: myPatientIds } },
      ];
    }

    if (query.from || query.to) {
      const fromStr = query.from ? `${query.from.slice(0, 10)}T00:00:00.000Z` : undefined;
      const toStr = query.to ? `${query.to.slice(0, 10)}T23:59:59.999Z` : undefined;

      where.appointmentDate = {
        gte: fromStr ? new Date(fromStr) : undefined,
        lte: toStr ? new Date(toStr) : undefined,
      };
    }

    return this.prisma.appointment.findMany({
      where,
      include: {
        patient: true,
        doctor: {
          include: {
            user: true,
          },
        },
        department: true,
        slot: true,
        queueTicket: true,
      },
      orderBy: { appointmentDate: 'desc' },
    });
  }

  // PATCH /appointments/:id/status — tuân theo state machine dùng chung (Phase 4 & Phase 5).
  // Giữ hàm dùng chung này cho các transition nội bộ (vd: được gọi lại từ confirm/checkIn/...)
  // Không còn expose thẳng qua controller — mỗi transition đã có API + permission riêng.
  private async transitionTo(appointmentId: string, nextStatus: AppointmentStatus) {
    const appointment = await this.findById(appointmentId);

    if (!isValidAppointmentTransition(appointment.status, nextStatus)) {
      throw new BadRequestException(
        `Không thể chuyển trạng thái từ '${appointment.status}' sang '${nextStatus}'`,
      );
    }

    return this.prisma.appointment.update({
      where: { appointmentId },
      data: { status: nextStatus },
    });
  }

  // PATCH /appointments/:id/confirm — reception xác nhận lịch (pending -> confirmed).
  async confirm(appointmentId: string) {
    return this.transitionTo(appointmentId, AppointmentStatus.CONFIRMED);
  }

  // PATCH /appointments/:id/check-in — bệnh nhân đặt lịch online ĐÃ CÓ MẶT tại bệnh viện.
  //
  // ReceptionCheckin + Encounter tại đây — SAI vì bỏ qua hoàn toàn cơ chế hàng đợi. Theo đúng
  // thiết kế đã có sẵn nhưng chưa từng dùng tới (xem comment QueueTicketPrefix trong
  // queue-ticket.constants.ts và compareQueueTickets — prefix A=online LUÔN ưu tiên hơn
  // B=at_hospital, trừ emergency), online và at_hospital phải CÙNG đi qua 1 hàng đợi
  // (QueueTicket) của khoa, chỉ khác thời điểm phát số: at_hospital phát số ngay lúc tạo lịch
  // (chưa biết bác sĩ), online phát số tại ĐÚNG THỜI ĐIỂM NÀY — lúc bệnh nhân thật sự có mặt
  // (đã biết sẵn bác sĩ từ lúc đặt). Từ đây, ticket đi qua chung
  // call() -> serve() -> done() với ticket at_hospital — ReceptionCheckin/Encounter chỉ được
  // tạo ở serve()/done() (đã có sẵn), KHÔNG tạo trùng ở check-in nữa.
  // CHỈ ONLINE
  async checkIn(appointmentId: string) {
    const appointment = await this.findById(appointmentId);

    if (appointment.bookingChannel === 'at_hospital') {
      throw new BadRequestException(
        'Lịch hẹn đăng ký tại bệnh viện đã có số thứ tự ngay từ lúc tạo, không cần check-in riêng',
      );
    }

    // Chỉ cho phát số khi lịch đã được lễ tân xác nhận (confirmed) — chưa xác nhận thì chưa cho
    // vào hàng đợi. Lưu ý: check-in KHÔNG đổi Appointment.status (giữ nguyên 'confirmed', giống
    // hệt cách at_hospital giữ 'pending' suốt lúc chờ) — status chỉ thật sự chuyển sang
    // 'checked_in' ở bước serve(), cùng lúc với việc tạo ReceptionCheckin.
    if (appointment.status !== AppointmentStatus.CONFIRMED) {
      throw new BadRequestException(
        `Chỉ có thể check-in khi lịch hẹn đang ở trạng thái 'confirmed', hiện tại là '${appointment.status}'`,
      );
    }

    const existingTicket = await this.prisma.queueTicket.findUnique({ where: { appointmentId } });
    if (existingTicket) {
      throw new BadRequestException('Lịch hẹn này đã có số thứ tự, không thể check-in lại');
    }

    return this.prisma.$transaction(async (tx) => {
      const queueTicket = await this.queueTicketService.issueTicketForAppointment(
        tx,
        appointment,
        QueueTicketPrefix.ONLINE,
      );
      return { appointment, queueTicket };
    });
  }

  // PATCH /appointments/:id/start — bác sĩ bắt đầu khám (checked_in -> in_progress).
  async start(appointmentId: string) {
    return this.transitionTo(appointmentId, AppointmentStatus.IN_PROGRESS);
  }

  // PATCH /appointments/:id/complete — bác sĩ hoàn tất khám (in_progress -> completed).
  async complete(appointmentId: string) {
    return this.transitionTo(appointmentId, AppointmentStatus.COMPLETED);
  }

  // PATCH /appointments/:id/no-show — bệnh nhân không đến (pending/confirmed/checked_in -> no_show).
  async markNoShow(appointmentId: string) {
    return this.transitionTo(appointmentId, AppointmentStatus.NO_SHOW);
  }

  // PATCH /appointments/:id/cancel — chỉ cho phép từ pending/confirmed.
  async cancel(appointmentId: string, dto: CancelAppointmentDto, currentUser?: RequestUser) {
    const appointment = await this.findById(appointmentId);

    if (currentUser) {
      const isStaff = hasPermissionScope(
        currentUser.permissions,
        Resource.APPOINTMENT,
        Action.UPDATE,
        Scope.ALL,
      );
      if (!isStaff && appointment.bookedByUserId !== currentUser.userId) {
        throw new ForbiddenException('Bạn chỉ có thể huỷ lịch hẹn do chính mình đặt');
      }
    }

    if (!canCancelAppointment(appointment.status)) {
      throw new BadRequestException(
        `Không thể huỷ lịch hẹn đang ở trạng thái '${appointment.status}'`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const cancelledAppointment = await tx.appointment.update({
        where: { appointmentId },
        data: {
          status: AppointmentStatus.CANCELLED,
          cancelledAt: new Date(),
          cancelReason: dto.cancelReason,
        },
      });

      // Nếu lịch hẹn có gắn slot (booking online) thì phải trả lại chỗ: giảm bookedCount
      // và mở lại status='free' để slot có thể được đặt lại.
      if (appointment.slotId) {
        await tx.appointmentSlot.update({
          where: { slotId: appointment.slotId },
          data: {
            bookedCount: { decrement: 1 },
            status: 'free',
          },
        });
      }

      return cancelledAppointment;
    });
  }
}