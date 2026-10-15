import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import {
    NotificationChannel,
    NotificationChannelStrategy,
    NotificationPayload,
} from '../notification-channel.interface';

@Injectable()
export class InAppNotificationStrategy implements NotificationChannelStrategy {
    readonly channel: NotificationChannel = 'in_app';

    constructor(private readonly prisma: PrismaService) {}

    async send(payload: NotificationPayload): Promise<void> {
        if (!payload.recipient.userId && !payload.recipient.patientId) {
            return;
        }

        const isScheduled = payload.scheduledAt && payload.scheduledAt > new Date();

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
                status: isScheduled ? 'queued' : 'sent',
                sentAt: isScheduled ? null : new Date(),
                scheduledAt: payload.scheduledAt ?? null,
            },
        });
    }
}
