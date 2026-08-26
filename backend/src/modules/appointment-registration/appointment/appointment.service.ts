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
  ) {}

  private generateAppointmentCode(): Promise<string> {
    return generateUniqueCode(APPOINTMENT_CODE_PREFIX, async (code) => {
      const existing = await this.prisma.appointment.findUnique({
        where: { appointmentCode: code },
      });
      return Boolean(existing);
    });
  }

  // POST /appointments (bookingChannel = online)
  async createOnline(dto: CreateAppointmentDto, currentUser: RequestUser) {
    // 1. patientId tồn tại.
    const patient = await this.prisma.patient.findUnique({ where: { patientId: dto.patientId } });
    if (!patient) {
      throw new NotFoundException('Không tìm thấy hồ sơ bệnh nhân');
    }

    // 2. Validate relationship theo đúng trạng thái sở hữu hiện tại của patient.
    const existingContact = await this.prisma.patientContact.findUnique({
      where: { userId_patientId: { userId: currentUser.userId, patientId: dto.patientId } },
    });

    const isSelf = dto.relationship === RelationshipType.SELF;
    const patientHasOwner = patient.userId !== null;

    if (isSelf) {
      if (patient.userId !== currentUser.userId) {
        throw new ForbiddenException(
          'Hồ sơ bệnh nhân này chưa được liên kết với tài khoản của bạn',
        );
      }
    } else if (patientHasOwner) {
      // Đã có chủ + relationship != self -> bắt buộc đã có contact "sạch" (đã duyệt) từ trước.
      if (!existingContact || isPendingRelationship(existingContact.relationship)) {
        throw new ForbiddenException(
          'Bạn chưa được xác nhận là người liên hệ của bệnh nhân này, vui lòng gửi yêu cầu và chờ chủ hồ sơ duyệt',
        );
      }
    } 
    // else: relationship != self và patient chưa có chủ -> tự do, xử lý ở bước tạo.

    // 3. AppointmentSlot tồn tại, thuộc đúng doctorId, status = free.
    const slot = await this.prisma.appointmentSlot.findUnique({
      where: { slotId: dto.slotId },
      include: { schedule: true },
    });
    if (!slot || slot.schedule.doctorId !== dto.doctorId || slot.status !== 'free') {
      throw new BadRequestException('Slot không tồn tại, không thuộc bác sĩ này, hoặc đã hết chỗ');
    }

    const appointmentCode = await this.generateAppointmentCode();

    return this.prisma.$transaction(async (tx) => {
      // Upsert PatientContact chỉ theo đúng nhánh đã được validate ở bước 2 (không upsert vô điều kiện).
      if (isSelf || !patientHasOwner) {
        if (!existingContact) {
          await tx.patientContact.create({
            data: {
              userId: currentUser.userId,
              patientId: dto.patientId,
              relationship: dto.relationship,
              isPrimaryContact: isSelf,
            },
          });
        }
      } else if (existingContact && existingContact.relationship !== dto.relationship) {
        // Patient đã có chủ, contact đã duyệt từ trước -> chỉ update relationship nếu khác,
        // không đụng isPrimaryContact, không tạo mới contact ở nhánh này.
        await tx.patientContact.update({
          where: { contactId: existingContact.contactId },
          data: { relationship: dto.relationship },
        });
      }

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

      // Điểm chống race condition quan trọng nhất: chỉ tăng bookedCount nếu vẫn còn chỗ trống
      // tại đúng thời điểm ghi (updateMany trả count=0 nghĩa là request khác đã chiếm hết chỗ).
      const slotUpdateResult = await tx.appointmentSlot.updateMany({
        where: { slotId: dto.slotId, bookedCount: { lt: slot.capacity } },
        data: { bookedCount: { increment: 1 } },
      });
      if (slotUpdateResult.count === 0) {
        throw new ConflictException('Slot đã đầy, vui lòng chọn slot khác');
      }

      const newBookedCount = slot.bookedCount + 1;// phải + 1 vì lúc này chỉ Database update nhưng bookCount trong slot trong code vẫn chưa
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
  async  createAtHospital(dto: CreateAtHospitalAppointmentDto, currentUser: RequestUser) {
    let patientId = dto.patientId;

    if (dto.contactId) {
      const contact = await this.prisma.patientContact.findUnique({
        where: { contactId: dto.contactId },
      });
      if (!contact) {
        throw new NotFoundException('Không tìm thấy liên hệ bệnh nhân (contactId)');
      }
      patientId = contact.patientId;
    }

    if (!patientId) {
      throw new BadRequestException('Cần cung cấp contactId hoặc patientId');
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
    const appointment = await this.prisma.appointment.findUnique({ where: { appointmentId } });
    if (!appointment) {
      throw new NotFoundException('Không tìm thấy lịch hẹn');
    }
    return appointment;
  }

  // GET /appointments?patientId=&status=&from=&to=
  findMany(query: FindAppointmentsQueryDto) {
    const where: Prisma.AppointmentWhereInput = {
      patientId: query.patientId,
      status: query.status,
    };

    if (query.from || query.to) {
      where.appointmentDate = {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(new Date(query.to).setHours(23, 59, 59, 999)) : undefined, // lấy đến cuối ngày hôm đó
      };
    }

    return this.prisma.appointment.findMany({
      where,
      orderBy: { appointmentDate: 'desc' },
    });
  }

  // PATCH /appointments/:id/status — tuân theo state machine dùng chung (Phase 4 & Phase 5).
  async updateStatus(appointmentId: string, dto: UpdateAppointmentStatusDto) {
    const appointment = await this.findById(appointmentId);

    if (!isValidAppointmentTransition(appointment.status, dto.status)) {
      throw new BadRequestException(
        `Không thể chuyển trạng thái từ '${appointment.status}' sang '${dto.status}'`,
      );
    }

    return this.prisma.appointment.update({
      where: { appointmentId },
      data: { status: dto.status },
    });
  }

  // PATCH /appointments/:id/cancel — chỉ cho phép từ pending/confirmed.
  async cancel(appointmentId: string, dto: CancelAppointmentDto) {
    const appointment = await this.findById(appointmentId);

    if (!canCancelAppointment(appointment.status)) {
      throw new BadRequestException(
        `Không thể huỷ lịch hẹn đang ở trạng thái '${appointment.status}'`,
      );
    }

    return this.prisma.appointment.update({
      where: { appointmentId },
      data: {
        status: AppointmentStatus.CANCELLED,
        cancelledAt: new Date(),
        cancelReason: dto.cancelReason,
      },
    });
  }
}
