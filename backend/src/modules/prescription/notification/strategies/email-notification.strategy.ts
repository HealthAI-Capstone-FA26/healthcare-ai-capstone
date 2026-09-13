import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import {
    NotificationChannel,
    NotificationChannelStrategy,
    NotificationPayload,
} from '../notification-channel.interface';
import { EMAIL_SENDER_PORT, EmailSenderPort } from '../ports/email-sender.port';

/**
 * Kênh email — kênh duy nhất triển khai cho domain prescription (Phase 6 kế hoạch module 9
 * chỉ yêu cầu email, chưa cần in-app/sms). Bỏ qua (không lưu bản ghi lỗi giả) nếu payload
 * không có sẵn `recipient.email` — dispatcher chịu trách nhiệm resolve email trước khi gọi,
 * strategy không tự tra cứu quan hệ Patient/User.
 */
@Injectable()
export class EmailNotificationStrategy implements NotificationChannelStrategy {
    private readonly logger = new Logger(EmailNotificationStrategy.name);
    readonly channel: NotificationChannel = 'email';

    constructor(
        private readonly prisma: PrismaService,
        @Inject(EMAIL_SENDER_PORT) private readonly emailSender: EmailSenderPort,
    ) {}

    async send(payload: NotificationPayload): Promise<void> {
        if (!payload.recipient.email) {
            this.logger.warn(
                `Bỏ qua gửi email (notificationType=${payload.notificationType}, referenceId=${payload.referenceId}): thiếu địa chỉ email người nhận.`,
            );
            return;
        }

        let status: 'sent' | 'failed' = 'sent';
        let sendError: unknown;
        try {
            await this.emailSender.sendEmail(payload.recipient.email, payload.title, payload.content);
        } catch (err) {
            status = 'failed';
            sendError = err;
        }

        await this.prisma.notification.create({
            data: {
                recipientUserId: payload.recipient.userId,
                recipientPatientId: payload.recipient.patientId,
                notificationType: payload.notificationType,
                channel: this.channel,
                referenceType: payload.referenceType,
                referenceId: payload.referenceId,
                title: payload.title,
                content: payload.content,
                status,
            },
        });

        if (sendError) {
            throw sendError;
        }
    }
}
