import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Notification } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SmsService } from '../sms/sms.service';
import { NotificationContactResolver } from './notification-contact.resolver';
import { NOTIFICATION_STATUS, NotificationChannelCode } from './notification.constants';
import { ZaloOaNotConfiguredError, ZaloOaSender } from './zalo-oa.sender';

/**
 * Worker thông báo trung tâm SE07: mỗi phút quét Notification `status='queued'` đã đến hạn
 * (`scheduledAt` null hoặc <= now) và gửi theo kênh. Đây là "worker SE07" mà các strategy sms/zalo_oa của
 * lab-test, payment, prescription chờ — đồng thời xử lý thông báo hẹn giờ (nhắc tái khám: scheduledAt tương lai).
 *
 *  - in_app: đánh dấu 'sent'.   - email: MailService.   - sms: SmsService.   - zalo_oa: ZaloOaSender.
 *  - Trước khi gửi luôn kiểm lại NotificationPreference / liên hệ; không gửi được vì người dùng tắt kênh hoặc
 *    thiếu liên hệ -> 'cancelled' (+ errorMessage), KHÔNG tính là lỗi.
 *  - Lỗi gửi thật: thử lại tối đa NOTIFICATION_MAX_RETRIES (mặc định 3) với backoff 1, 4, 9... phút rồi 'failed'.
 *  - Nhiều instance chạy song song an toàn: "chiếm" bản ghi bằng updateMany có điều kiện retryCount.
 * Cấu hình: NOTIFICATION_WORKER_ENABLED (mặc định true), NOTIFICATION_WORKER_BATCH (mặc định 50).
 */
@Injectable()
export class NotificationWorkerService {
  private readonly logger = new Logger(NotificationWorkerService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly resolver: NotificationContactResolver,
    private readonly mail: MailService,
    private readonly sms: SmsService,
    private readonly zalo: ZaloOaSender,
  ) { }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.config.get<string>('NOTIFICATION_WORKER_ENABLED') === 'false') return;
    if (this.running) return; // tránh chồng lượt khi lượt trước chưa xong
    this.running = true;
    try {
      const processed = await this.processDue();
      if (processed > 0) this.logger.log(`Đã xử lý ${processed} thông báo đến hạn`);
    } catch (err) {
      this.logger.error(`Worker thông báo lỗi: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }

  /** Public để test / kích hoạt thủ công. Trả về số bản ghi đã chiếm và xử lý. */
  async processDue(): Promise<number> {
    const batch = Number(this.config.get<string>('NOTIFICATION_WORKER_BATCH') ?? 50);
    const due = await this.prisma.notification.findMany({
      where: {
        status: NOTIFICATION_STATUS.QUEUED,
        OR: [{ scheduledAt: null }, { scheduledAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
      take: batch,
    });

    let processed = 0;
    for (const row of due) {
      const claimed = await this.prisma.notification.updateMany({
        where: { notificationId: row.notificationId, status: NOTIFICATION_STATUS.QUEUED, retryCount: row.retryCount },
        data: { retryCount: { increment: 1 } },
      });
      if (claimed.count === 0) continue; // instance khác đã chiếm

      processed += 1;
      await this.deliver({ ...row, retryCount: row.retryCount + 1 });
    }
    return processed;
  }

  private async deliver(row: Notification): Promise<void> {
    const channel = row.channel as NotificationChannelCode;
    try {
      const resolution = await this.resolver.resolve(
        { userId: row.recipientUserId, patientId: row.recipientPatientId },
        channel,
        row.notificationType,
      );
      if (!resolution.allowed) {
        await this.markCancelled(row, resolution.reason ?? 'NOT_ALLOWED');
        return;
      }

      switch (channel) {
        case 'in_app':
          break; // "gửi" = hiển thị trong app
        case 'email':
          await this.mail.sendPlainMail(resolution.destination!, row.title, row.content);
          break;
        case 'sms':
          await this.sms.sendText(resolution.destination!, `${row.title}: ${row.content}`);
          break;
        case 'zalo_oa':
          await this.zalo.sendText(resolution.destination!, `${row.title}\n${row.content}`);
          break;
        default:
          await this.markFailed(row, `Kênh không hỗ trợ: ${row.channel}`);
          return;
      }

      await this.prisma.notification.update({
        where: { notificationId: row.notificationId },
        data: { status: NOTIFICATION_STATUS.SENT, sentAt: new Date(), errorMessage: null },
      });
    } catch (err) {
      const message = (err as Error)?.message ?? 'unknown error';
      const retryable = !(err instanceof ZaloOaNotConfiguredError);
      const maxRetries = Number(this.config.get<string>('NOTIFICATION_MAX_RETRIES') ?? 3);

      if (!retryable || row.retryCount >= maxRetries) {
        await this.markFailed(row, message);
      } else {
        const backoffMs = row.retryCount * row.retryCount * 60_000; // 1, 4, 9 phút
        await this.prisma.notification.update({
          where: { notificationId: row.notificationId },
          data: { errorMessage: message.slice(0, 500), scheduledAt: new Date(Date.now() + backoffMs) },
        });
      }
      this.logger.warn(`Gửi thông báo ${row.notificationId} (${row.channel}) lỗi lần ${row.retryCount}: ${message}`);
    }
  }

  private markCancelled(row: Notification, reason: string) {
    return this.prisma.notification.update({
      where: { notificationId: row.notificationId },
      data: { status: NOTIFICATION_STATUS.CANCELLED, errorMessage: reason },
    });
  }

  private markFailed(row: Notification, message: string) {
    return this.prisma.notification.update({
      where: { notificationId: row.notificationId },
      data: { status: NOTIFICATION_STATUS.FAILED, errorMessage: message.slice(0, 500) },
    });
  }
}
