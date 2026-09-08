import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import {
    NotificationChannel,
    NotificationChannelStrategy,
    NotificationPayload,
} from '../notification-channel.interface';
import { PUSH_SENDER_PORT, PushSenderPort } from '../ports/push-sender.port';

/**
 * Kênh push — ƯU TIÊN THẤP HƠN email/in-app theo yêu cầu hiện tại (PushSenderPort mặc định
 * hiện là stub, xem push-sender.port.ts). Bỏ qua nếu payload không có `recipient.pushToken`.
 */
@Injectable()
export class PushNotificationStrategy implements NotificationChannelStrategy {
    private readonly logger = new Logger(PushNotificationStrategy.name);
    readonly channel: NotificationChannel = 'push';

    constructor(
        private readonly prisma: PrismaService,
        @Inject(PUSH_SENDER_PORT) private readonly pushSender: PushSenderPort,
    ) {}

    async send(payload: NotificationPayload): Promise<void> {
        if (!payload.recipient.pushToken) {
            this.logger.warn(
                `Bỏ qua gửi push (notificationType=${payload.notificationType}, referenceId=${payload.referenceId}): thiếu push token người nhận.`,
            );
            return;
        }

        let status: 'sent' | 'failed' = 'sent';
        let sendError: unknown;
        try {
            await this.pushSender.sendPush(payload.recipient.pushToken, payload.title, payload.content);
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
