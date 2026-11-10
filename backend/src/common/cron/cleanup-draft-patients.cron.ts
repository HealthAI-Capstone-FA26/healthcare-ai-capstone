import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';
import { PatientStatus, DRAFT_PATIENT_RETENTION_DAYS } from '../constants/patient-status.constants';

const LOCK_TTL_SECONDS = 5 * 60;
const LOCK_KEY_PREFIX = 'cleanup-draft-patients';

/**
 * Chạy hàng ngày: Patient status='draft' (tạo tự động từ luồng đặt lịch guest qua OTP — xem
 * GuestAppointmentService) mà quá DRAFT_PATIENT_RETENTION_DAYS ngày vẫn CHƯA được lễ tân xác
 * nhận chuyển sang status='main' (xem PatientService.confirmMain) thì bị xoá cùng các
 * Appointment liên quan.
 */
@Injectable()
export class CleanupDraftPatientsCron {
  private readonly logger = new Logger(CleanupDraftPatientsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async handleCron() {
    const today = new Date().toISOString().slice(0, 10);
    const lockKey = `${LOCK_KEY_PREFIX}:${today}`;

    const token = await this.redisService.acquireLock(lockKey, LOCK_TTL_SECONDS);
    if (!token) {
      this.logger.log(`Bỏ qua chạy cron dọn draft patient: instance khác đang giữ lock "${lockKey}"`);
      return;
    }

    try {
      return await this.run();
    } finally {
      await this.redisService.releaseLock(lockKey, token);
    }
  }

  async run() {
    const cutoff = new Date(Date.now() - DRAFT_PATIENT_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const candidates = await this.prisma.patient.findMany({
      where: { status: PatientStatus.DRAFT, createdAt: { lt: cutoff } },
      include: { appointments: true, suggestedAppointments: true },
    });

    let deletedCount = 0;
    let skippedCount = 0;

    for (const patient of candidates) {
      const appointments = [...patient.appointments, ...patient.suggestedAppointments];

      try {
        await this.prisma.$transaction(async (tx) => {
          for (const appt of appointments) {
            if (appt.slotId) {
              await tx.appointmentSlot.update({
                where: { slotId: appt.slotId },
                data: { bookedCount: { decrement: 1 }, status: 'free' },
              });
            }
            await tx.appointment.delete({ where: { appointmentId: appt.appointmentId } });
          }

          await tx.patient.delete({ where: { patientId: patient.patientId } });
        });
        deletedCount++;
      } catch (err) {
        // Còn dữ liệu khác tham chiếu tới patient (consent, allergy, medical history...) mà
        // RESTRICT FK chặn xoá -> bỏ qua, không làm crash cả job vì 1 patient lỗi.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
          this.logger.warn(
            `Bỏ qua xoá patient draft ${patient.patientId}: còn dữ liệu khác tham chiếu (FK constraint)`,
          );
          skippedCount++;
        } else {
          throw err;
        }
      }
    }

    this.logger.log(
      `Đã xoá ${deletedCount} patient draft quá hạn (>${DRAFT_PATIENT_RETENTION_DAYS} ngày) cùng appointment, bỏ qua ${skippedCount}`,
    );
    return { deletedCount, skippedCount };
  }
}
