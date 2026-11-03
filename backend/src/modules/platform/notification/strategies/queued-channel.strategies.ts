import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { NotificationContactResolver } from '../notification-contact.resolver';
import { NotificationChannelCode, SMS_MILESTONE_TYPES } from '../notification.constants';

/** Payload tối thiểu — cấu trúc tương thích NotificationPayload của lab-test / payment / prescription. */
export interface QueuedNotificationPayload {
  recipient: { userId?: string; patientId?: string; email?: string };
  notificationType: string;
  referenceType: string;
  referenceId: string;
  title: string;
  content: string;
  scheduledAt?: Date;
}

/**
 * Kênh SMS / Zalo OA dùng chung cho module payment & prescription (lab-test vẫn dùng bản riêng).
 * Chỉ GHI Notification 'queued' — NotificationWorkerService mới là nơi gọi nhà mạng/Zalo.
 * Bỏ qua (không ghi) nếu người nhận tắt kênh trong NotificationPreference hoặc không có phương tiện liên hệ,
 * để không sinh bản ghi rác.
 *
 * LƯU Ý DI: lớp con @Injectable PHẢI khai báo constructor tường minh (lớp cha trừu tượng không phát metadata).
 */
abstract class CentralQueuedStrategy {
  abstract readonly channel: NotificationChannelCode;

  constructor(
    protected readonly prisma: PrismaService,
    protected readonly resolver: NotificationContactResolver,
  ) { }

  async send(payload: QueuedNotificationPayload): Promise<void> {
    const resolution = await this.resolver.resolve(payload.recipient, this.channel, payload.notificationType);
    if (!resolution.allowed) return;

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
        scheduledAt: payload.scheduledAt ?? null,
      },
    });
  }
}

@Injectable()
export class CentralSmsNotificationStrategy extends CentralQueuedStrategy {
  readonly channel: NotificationChannelCode = 'sms';

  constructor(prisma: PrismaService, resolver: NotificationContactResolver) {
    super(prisma, resolver);
  }

  async send(payload: QueuedNotificationPayload): Promise<void> {
    if (!SMS_MILESTONE_TYPES.includes(payload.notificationType)) return;
    await super.send(payload);
  }
}

@Injectable()
export class CentralZaloOaNotificationStrategy extends CentralQueuedStrategy {
  readonly channel: NotificationChannelCode = 'zalo_oa';

  constructor(prisma: PrismaService, resolver: NotificationContactResolver) {
    super(prisma, resolver);
  }
}
