import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import {
  DoctorScheduleService,
  ResolvedScheduleInput,
} from '../../modules/appointment-registration/doctor-schedule/doctor-schedule.service';
import {
  DEFAULT_MAX_PATIENTS_PER_SLOT,
  DEFAULT_SLOT_DURATION_MINS,
  ScheduleSession,
  SESSION_DEFAULTS,
  timeOfDay,
} from '../constants/schedule-session.constants';

const LOCK_TTL_SECONDS = 5 * 60;

/**
 * Chạy định kỳ mỗi Chủ nhật 00:00 -> sinh DoctorSchedule + AppointmentSlot cho TUẦN KẾ TIẾP
 * (thứ 2 -> Chủ nhật, đủ 7 ngày) cho tất cả bác sĩ đang active, ở cả 3 session.
 *
 * Bệnh viện Tâm Anh khám ngoại trú đủ 7 ngày/tuần (không nghỉ Chủ nhật) — đã xác nhận qua tra cứu
 * thực tế thời gian khám ngoại trú công bố của bệnh viện, nên KHÔNG loại Chủ nhật khỏi lịch sinh.
 *
 * Giả định tạm thời (CHƯA có model "lịch làm việc định kỳ theo bác sĩ" trong schema hiện tại):
 * mọi bác sĩ active làm việc cả 3 session, đủ 7 ngày/tuần. Khi có bảng cấu hình
 * availability riêng cho từng bác sĩ (vd 1 số bác sĩ không làm Chủ nhật), thay thế đoạn
 * resolveDoctorsToGenerate() bên dưới.
 */
@Injectable()
export class WeeklyScheduleGenCron {
  private readonly logger = new Logger(WeeklyScheduleGenCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly doctorScheduleService: DoctorScheduleService,
  ) {}

  @Cron(CronExpression.EVERY_WEEK) // 00:00 mỗi Chủ nhật
  async handleCron() {
    await this.triggerWeeklyGeneration();
  }

  // Trigger dùng chung cho cron định kỳ và endpoint manual.
  async triggerWeeklyGeneration(weekMonday?: Date) {
    const targetWeekMonday = weekMonday ?? getNextWeekMonday(new Date());
    const lockKey = `weekly-schedule-gen:${formatIsoDate(targetWeekMonday)}`;

    const token = await this.redisService.acquireLock(lockKey, LOCK_TTL_SECONDS);
    if (!token) {
      this.logger.log(`Bỏ qua chạy cron: instance khác đang giữ lock "${lockKey}"`);
      return {
        created: 0,
        skipped: 0,
        lockAcquired: false,
        weekMonday: formatIsoDate(targetWeekMonday),
      };
    }

    try {
      const result = await this.run(targetWeekMonday);
      return {
        ...result,
        lockAcquired: true,
        weekMonday: formatIsoDate(targetWeekMonday),
      };
    } finally {
      await this.redisService.releaseLock(lockKey, token);
    }
  }

  async run(weekMonday: Date) {
    const doctors = await this.prisma.doctor.findMany({
      where: { isActive: true },
      include: { doctorDepartments: { where: { isPrimary: true } } },
    });

    let created = 0;
    let skipped = 0;

    for (const doctor of doctors) {
      const primaryDepartmentId = doctor.doctorDepartments[0]?.departmentId;
      if (!primaryDepartmentId) {
        this.logger.warn(`Bỏ qua doctorId=${doctor.doctorId}: chưa có khoa chính`);
        continue;
      }

      for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
        // thứ 2 (offset 0) -> Chủ nhật (offset 6), đủ 7 ngày (bệnh viện khám ngoại trú cả tuần)
        const workDate = addDays(weekMonday, dayOffset);

        for (const session of Object.values(ScheduleSession)) {
          const sessionDefault = SESSION_DEFAULTS[session];
          const input: ResolvedScheduleInput = {
            doctorId: doctor.doctorId,
            departmentId: primaryDepartmentId,
            workDate,
            session,
            startTime: timeOfDay(sessionDefault.startTime),
            endTime: timeOfDay(sessionDefault.endTime),
            slotDurationMins: DEFAULT_SLOT_DURATION_MINS,
            maxPatientsPerSlot: DEFAULT_MAX_PATIENTS_PER_SLOT,
          };

          // Service sẽ chia khoảng session thành các slot 60 phút, mỗi slot tối đa 3 bệnh nhân.

          // Check tồn tại trước (giảm số lần bắt lỗi unique khi job chạy lại nhiều lần)
          // eslint-disable-next-line no-await-in-loop
          const existing = await this.prisma.doctorSchedule.findUnique({
            where: {
              doctorId_workDate_session: {
                doctorId: input.doctorId,
                workDate: input.workDate,
                session: input.session,
              },
            },
          });
          if (existing) {
            skipped += 1;
            continue;
          }

          // eslint-disable-next-line no-await-in-loop
          const result = await this.doctorScheduleService.createScheduleAndSlots(input);
          if (result) {
            created += 1;
          } else {
            skipped += 1;
          }
        }
      }
    }

    this.logger.log(
      `Weekly schedule gen cho tuần ${formatIsoDate(weekMonday)}: tạo mới ${created}, bỏ qua (đã tồn tại) ${skipped}`,
    );
    return { created, skipped };
  }
}

function getNextWeekMonday(from: Date): Date {
  const day = from.getUTCDay(); // 0 = CN, 1 = Thứ 2, ...
  const daysUntilNextMonday = ((8 - day) % 7) || 7;
  return addDays(startOfUtcDay(from), daysUntilNextMonday);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}