import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { NotificationService } from '../../modules/platform/notification/notification.service';
import { toDateOnlyUTC } from '../constants/queue-ticket.constants';
import { getHospitalWallClockNow } from '../utils/hospital-clock.util';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_RUN = 500;

/**
 * SE06/SE07 — Nhắc lịch hẹn tự động. Mỗi giờ từ 07:00 đến 20:00 (giờ VN) quét các lịch hẹn ONLINE / TÁI KHÁM diễn ra
 * sau REMINDER_DAYS_BEFORE ngày (mặc định 1) còn ở trạng thái pending|confirmed và gửi nhắc đa kênh
 * (in_app + email + sms + zalo_oa — tuỳ NotificationPreference) qua NotificationService.
 *
 * Idempotent: bỏ qua lịch đã có thông báo nhắc (queued|sent) cùng loại — kể cả nhắc tái khám đã được
 * PrescriptionFollowupService hẹn giờ lúc đặt lịch. Vì vậy chạy nhiều lần/giờ hay restart server đều không gửi trùng,
 * và cron này đóng vai trò lưới an toàn cho lịch đặt online thông thường (chưa có nhắc nào).
 * Cấu hình: REMINDER_CRON_ENABLED=false để tắt; REMINDER_DAYS_BEFORE.
 */
@Injectable()
export class AppointmentReminderCron {
  private readonly logger = new Logger(AppointmentReminderCron.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly notificationService: NotificationService,
  ) { }

  @Cron('0 7-20 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async handleCron(): Promise<void> {
    if (this.config.get<string>('REMINDER_CRON_ENABLED') === 'false') return;
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.sendReminders();
      if (sent > 0) this.logger.log(`Đã tạo nhắc hẹn cho ${sent} lịch hẹn`);
    } catch (err) {
      this.logger.error(`Cron nhắc hẹn lỗi: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }

  /** Public để chạy thủ công/test. Trả về số lịch hẹn đã được tạo nhắc. */
  async sendReminders(): Promise<number> {
    const daysBefore = Math.max(0, Number(this.config.get<string>('REMINDER_DAYS_BEFORE') ?? 1));
    const targetDate = new Date(toDateOnlyUTC(getHospitalWallClockNow()).getTime() + daysBefore * DAY_MS);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        appointmentDate: targetDate,
        status: { in: ['pending', 'confirmed'] },
        bookingChannel: { in: ['online', 'doctor_follow_up'] },
        patientId: { not: null },
      },
      select: {
        appointmentId: true,
        appointmentCode: true,
        appointmentType: true,
        appointmentTime: true,
        appointmentDate: true,
        reasonForVisit: true,
        patient: { select: { patientId: true, userId: true } },
        doctor: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_PER_RUN,
    });

    let created = 0;
    for (const appt of appointments) {
      if (!appt.patient) continue;
      const isFollowUp = appt.appointmentType === 'follow_up';
      const notificationType = isFollowUp ? 'follow_up_reminder' : 'appointment_reminder';

      const already = await this.prisma.notification.findFirst({
        where: {
          referenceType: 'appointment',
          referenceId: appt.appointmentId,
          notificationType,
          status: { in: ['queued', 'sent'] },
        },
        select: { notificationId: true },
      });
      if (already) continue;

      const dateText = appt.appointmentDate.toLocaleDateString('vi-VN', { timeZone: 'UTC' });
      const timeText = appt.appointmentTime ? ` lúc ${appt.appointmentTime.toISOString().slice(11, 16)}` : '';
      const doctorText = appt.doctor ? ` với BS. ${appt.doctor.fullName}` : '';

      try {
        const channels = await this.notificationService.enqueue({
          recipient: { patientId: appt.patient.patientId, userId: appt.patient.userId ?? undefined },
          notificationType,
          referenceType: 'appointment',
          referenceId: appt.appointmentId,
          title: isFollowUp ? 'Nhắc lịch tái khám chuyên khoa Tim mạch' : 'Nhắc lịch khám chuyên khoa Tim mạch',
          content:
            `Bạn có lịch hẹn ${appt.appointmentCode} vào ngày ${dateText}${timeText}${doctorText}. ` +
            'Vui lòng đến đúng giờ và mang theo CCCD, thẻ BHYT.',
        });
        if (channels > 0) created += 1;
      } catch (err) {
        this.logger.warn(`Không tạo được nhắc hẹn cho ${appt.appointmentCode}: ${(err as Error).message}`);
      }
    }
    return created;
  }
}
