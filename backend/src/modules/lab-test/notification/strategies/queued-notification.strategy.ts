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

/**
 * LƯU Ý DI: lớp cha trừu tượng KHÔNG có decorator nên TypeScript không phát metadata `design:paramtypes` cho nó —
 * mỗi lớp con @Injectable PHẢI khai báo constructor tường minh, nếu không Nest không inject PrismaService
 * (lỗi âm thầm: `this.prisma` undefined, thông báo sms/zalo_oa không được ghi).
 */
@Injectable()
export class SmsNotificationStrategy extends QueuedNotificationStrategy {
    readonly channel: NotificationChannel = 'sms';

    constructor(prisma: PrismaService) {
        super(prisma);
    }
}

@Injectable()
export class ZaloOaNotificationStrategy extends QueuedNotificationStrategy {
    readonly channel: NotificationChannel = 'zalo_oa';

    constructor(prisma: PrismaService) {
        super(prisma);
    }
}
