import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AppointmentSlotService } from '../appointment-slot/appointment-slot.service';
import { CreateDoctorScheduleDto } from './dto/create-doctor-schedule.dto';
import { SearchDoctorScheduleDto } from './dto/search-doctor-schedule.dto';
import {
  DEFAULT_MAX_PATIENTS_PER_SLOT,
  DEFAULT_SLOT_DURATION_MINS,
  ScheduleSession,
  SESSION_DEFAULTS,
  timeOfDay,
} from '../../../common/constants/schedule-session.constants';

export interface ResolvedScheduleInput {
  doctorId: string;
  departmentId: string;
  workDate: Date;
  session: ScheduleSession;
  startTime: Date;
  endTime: Date;
  slotDurationMins: number;
  maxPatientsPerSlot: number;
}

@Injectable()
export class DoctorScheduleService {
  private readonly logger = new Logger(DoctorScheduleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentSlotService: AppointmentSlotService,
  ) {}

  // POST /doctor-schedules — tạo lịch thủ công
  async create(dto: CreateDoctorScheduleDto) {
    const doctor = await this.prisma.doctor.findUnique({ where: { doctorId: dto.doctorId } });
    if (!doctor) {
      throw new NotFoundException('Không tìm thấy bác sĩ');
    }

    const departmentId = dto.departmentId ?? (await this.resolvePrimaryDepartmentId(dto.doctorId));

    const sessionDefault = SESSION_DEFAULTS[dto.session];
    const resolved: ResolvedScheduleInput = {
      doctorId: dto.doctorId,
      departmentId,
      workDate: new Date(`${dto.workDate}T00:00:00.000Z`),
      session: dto.session,
      startTime: timeOfDay(dto.startTime ?? sessionDefault.startTime),
      endTime: timeOfDay(dto.endTime ?? sessionDefault.endTime),
      slotDurationMins: dto.slotDurationMins ?? DEFAULT_SLOT_DURATION_MINS,
      maxPatientsPerSlot: dto.maxPatientsPerSlot ?? DEFAULT_MAX_PATIENTS_PER_SLOT,
    };

    if (resolved.startTime.getTime() >= resolved.endTime.getTime()) {
      throw new BadRequestException('startTime phải nhỏ hơn endTime');
    }

    const existing = await this.prisma.doctorSchedule.findUnique({
      where: {
        doctorId_workDate_session: {
          doctorId: resolved.doctorId,
          workDate: resolved.workDate,
          session: resolved.session,
        },
      },
    });
    if (existing) {
      throw new ConflictException('Bác sĩ đã có lịch cho ngày + session này');
    }

    return this.createScheduleAndSlots(resolved);
  }

  /**
   * Tạo DoctorSchedule + sinh AppointmentSlot trong 1 transaction.
   * Dùng chung cho cả API tạo thủ công lẫn cron sinh lịch hàng tuần.
   * Bắt luôn lỗi unique constraint (P2002) để idempotent khi có race giữa nhiều lần chạy/instance.
   */
  async createScheduleAndSlots(input: ResolvedScheduleInput) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const schedule = await tx.doctorSchedule.create({
          data: {
            doctorId: input.doctorId,
            departmentId: input.departmentId,
            workDate: input.workDate,
            session: input.session,
            startTime: input.startTime,
            endTime: input.endTime,
            slotDurationMins: input.slotDurationMins,
            maxPatientsPerSlot: input.maxPatientsPerSlot,
          },
        });

        const slotCount = await this.appointmentSlotService.generateSlotsForSchedule(tx, schedule);

        return { schedule, slotCount };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Lịch (doctorId, workDate, session) đã tồn tại -> coi như đã sinh rồi, bỏ qua êm (idempotent).
        this.logger.warn(
          `Bỏ qua tạo trùng lịch doctorId=${input.doctorId} workDate=${input.workDate.toISOString()} session=${input.session}`,
        );
        return null;
      }
      throw error;
    }
  }

  private async resolvePrimaryDepartmentId(doctorId: string): Promise<string> {
    const primary = await this.prisma.doctorDepartment.findFirst({
      where: { doctorId, isPrimary: true },
    });
    if (!primary) {
      throw new BadRequestException(
        'Bác sĩ chưa có khoa chính (isPrimary=true), vui lòng truyền departmentId hoặc gán khoa cho bác sĩ trước',
      );
    }
    return primary.departmentId;
  }

  // GET /doctor-schedules?doctorId=&from=&to=
  findAll(query: SearchDoctorScheduleDto) {
    const where: Prisma.DoctorScheduleWhereInput = {};

    if (query.doctorId) {
      where.doctorId = query.doctorId;
    }
    if (query.from || query.to) {
      where.workDate = {
        gte: query.from ? new Date(`${query.from}T00:00:00.000Z`) : undefined,
        lte: query.to ? new Date(`${query.to}T00:00:00.000Z`) : undefined,
      };
    }

    return this.prisma.doctorSchedule.findMany({
      where,
      include: { appointmentSlots: true, department: true },
      orderBy: [{ workDate: 'asc' }, { session: 'asc' }],
    });
  }

  async findById(scheduleId: string) {
    const schedule = await this.prisma.doctorSchedule.findUnique({
      where: { scheduleId },
      include: { appointmentSlots: true, department: true },
    });
    if (!schedule) {
      throw new NotFoundException('Không tìm thấy lịch làm việc');
    }
    return schedule;
  }

  // PATCH /doctor-schedules/:id/cancel — báo nghỉ
  async cancel(scheduleId: string, reason?: string) {
    const schedule = await this.findById(scheduleId);

    if (schedule.status === 'cancelled') {
      throw new ConflictException('Lịch này đã được huỷ trước đó');
    }

    return this.prisma.$transaction(async (tx) => {
      const updatedSchedule = await tx.doctorSchedule.update({
        where: { scheduleId },
        data: { status: 'cancelled' },
      });

      // Slot còn free -> blocked (không ai đặt được nữa)
      const blockedResult = await tx.appointmentSlot.updateMany({
        where: { scheduleId, status: 'free' },
        data: { status: 'blocked' },
      });

      // Slot đã có appointment (status != free, != blocked vừa update ở trên) -> KHÔNG đổi, chỉ log để xử lý riêng
      const impactedSlots = await tx.appointmentSlot.findMany({
        where: { scheduleId, status: { notIn: ['free', 'blocked'] } },
      });
      if (impactedSlots.length > 0) {
        this.logger.warn(
          `Huỷ lịch scheduleId=${scheduleId} nhưng còn ${impactedSlots.length} slot đã có appointment ` +
            `(slotId: ${impactedSlots.map((s) => s.slotId).join(', ')}) — cần xử lý báo bệnh nhân/re-schedule riêng.`,
        );
      }

      return {
        schedule: updatedSchedule,
        blockedFreeSlots: blockedResult.count,
        impactedBookedSlots: impactedSlots.length,
        reason,
      };
    });
  }
}
