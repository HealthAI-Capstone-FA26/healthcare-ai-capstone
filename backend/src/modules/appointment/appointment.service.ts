import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { generateUniqueCode } from '../../common/utils/code-generator.util';
import {
  AppointmentStatus,
  canCancelAppointment,
  isValidAppointmentTransition,
} from '../../common/utils/appointment-status.util';
import { RelationshipType } from '../../common/constants/relationship.constants';
import { isPendingRelationship } from '../../common/constants/patient-contact.constants';
import { PatientContactService } from '../patientContact/patient-contact.service';
import { RequestUser } from '../auth/strategies/jwt.strategy';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { FindAppointmentsQueryDto } from './dto/find-appointments-query.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';

const APPOINTMENT_CODE_PREFIX = 'LH';

@Injectable()
export class AppointmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly patientContactService: PatientContactService,
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

  // PATCH /appointments/:id/check-in — reception check-in tại quầy (confirmed -> checked_in).
  async checkIn(appointmentId: string) {
    return this.transitionTo(appointmentId, AppointmentStatus.CHECKED_IN);
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
