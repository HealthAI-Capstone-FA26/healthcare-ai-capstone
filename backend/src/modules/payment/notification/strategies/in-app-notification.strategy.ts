import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import {
    NotificationChannel,
    NotificationChannelStrategy,
    NotificationPayload,
} from '../notification-channel.interface';

/**
 * Kênh in-app (hệ thống) — "gửi" chính là ghi thẳng vào bảng notification: client đọc qua
 * danh sách thông báo trong app (ngoài phạm vi module payment) nên coi như 'sent' ngay khi
 * lưu thành công.
 */
@Injectable()
export class InAppNotificationStrategy implements NotificationChannelStrategy {
    readonly channel: NotificationChannel = 'in_app';

    constructor(private readonly prisma: PrismaService) {}

    async send(payload: NotificationPayload): Promise<void> {
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
                status: 'sent',
            },
        });
    }
}
