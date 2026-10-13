import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import {
    NotificationChannel,
    NotificationChannelStrategy,
    NotificationPayload,
} from '../notification-channel.interface';

/**
 * Kênh SMS / Zalo OA: module lab-test KHÔNG gọi nhà mạng. Chỉ ghi 1 bản ghi Notification `status='queued'` để
 * worker thông báo trung tâm (SE07 — có tôn trọng NotificationPreference) lấy ra gửi. Tránh nhân bản sender ở từng
 * module. Nếu người nhận là bệnh nhân/user không có phương tiện liên hệ, worker sẽ đánh dấu 'failed' ở phía nó.
 */
abstract class QueuedNotificationStrategy implements NotificationChannelStrategy {
    abstract readonly channel: NotificationChannel;

    constructor(protected readonly prisma: PrismaService) {}

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
                status: 'queued',
            },
        });
    }
}

@Injectable()
export class SmsNotificationStrategy extends QueuedNotificationStrategy {
    readonly channel: NotificationChannel = 'sms';
}

@Injectable()
export class ZaloOaNotificationStrategy extends QueuedNotificationStrategy {
    readonly channel: NotificationChannel = 'zalo_oa';
}
