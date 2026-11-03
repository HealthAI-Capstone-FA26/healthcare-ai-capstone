import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { NotificationContactResolver } from './notification-contact.resolver';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUS,
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_WILDCARD,
  NotificationChannelCode,
  SMS_MILESTONE_TYPES,
} from './notification.constants';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

export interface EnqueueNotificationInput {
  recipient: { userId?: string; patientId?: string };
  notificationType: string;
  referenceType: string;
  referenceId: string;
  title: string;
  content: string;
  /** Có giá trị tương lai -> mọi kênh (kể cả in_app) ở trạng thái 'queued' đến khi worker gửi. */
  scheduledAt?: Date;
  /** Mặc định: tất cả kênh. */
  channels?: NotificationChannelCode[];
}

/**
 * SE07 — Thông báo đa kênh (in_app / email / sms / zalo_oa) dùng chung toàn hệ thống:
 *  - Người dùng: xem lịch sử thông báo, đánh dấu đã đọc, cấu hình kênh nhận (NotificationPreference).
 *  - Hệ thống: enqueue() ghi thông báo đa kênh có tôn trọng preference; NotificationWorkerService gửi thật.
 */
@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contactResolver: NotificationContactResolver,
  ) { }

  /** Thông báo của 1 user = gửi trực tiếp cho user + gửi cho hồ sơ bệnh nhân gắn với user (Patient.userId). */
  private async ownerWhere(userId: string): Promise<Prisma.NotificationWhereInput> {
    const patient = await this.prisma.patient.findUnique({ where: { userId }, select: { patientId: true } });
    const ors: Prisma.NotificationWhereInput[] = [{ recipientUserId: userId }];
    if (patient) ors.push({ recipientPatientId: patient.patientId });
    return { OR: ors };
  }

  async list(userId: string, query: ListNotificationsQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const and: Prisma.NotificationWhereInput[] = [
      await this.ownerWhere(userId),
      { channel: query.channel ?? 'in_app' },
      { status: query.status ?? NOTIFICATION_STATUS.SENT },
    ];
    if (query.notificationType) and.push({ notificationType: query.notificationType });
    if (query.unreadOnly) and.push({ readAt: null });
    const where: Prisma.NotificationWhereInput = { AND: and };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  async unreadCount(userId: string) {
    const count = await this.prisma.notification.count({
      where: {
        AND: [
          await this.ownerWhere(userId),
          { channel: 'in_app', status: NOTIFICATION_STATUS.SENT, readAt: null },
        ],
      },
    });
    return { unread: count };
  }

  async markRead(userId: string, notificationId: string) {
    const existing = await this.prisma.notification.findFirst({
      where: { AND: [await this.ownerWhere(userId), { notificationId }] },
    });
    if (!existing) {
      throw new NotFoundException('Không tìm thấy thông báo');
    }
    if (existing.readAt) return existing;
    return this.prisma.notification.update({ where: { notificationId }, data: { readAt: new Date() } });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.notification.updateMany({
      where: {
        AND: [
          await this.ownerWhere(userId),
          { channel: 'in_app', status: NOTIFICATION_STATUS.SENT, readAt: null },
        ],
      },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }

  async getPreferences(userId: string) {
    const preferences = await this.prisma.notificationPreference.findMany({
      where: { userId },
      orderBy: [{ channel: 'asc' }, { notificationType: 'asc' }],
    });
    return {
      channels: NOTIFICATION_CHANNELS,
      notificationTypes: [NOTIFICATION_TYPE_WILDCARD, ...NOTIFICATION_TYPES],
      preferences,
    };
  }

  async upsertPreferences(userId: string, dto: UpdateNotificationPreferencesDto) {
    await this.prisma.$transaction(
      dto.preferences.map((item) =>
        this.prisma.notificationPreference.upsert({
          where: {
            userId_channel_notificationType: {
              userId,
              channel: item.channel,
              notificationType: item.notificationType,
            },
          },
          create: {
            userId,
            channel: item.channel,
            notificationType: item.notificationType,
            isEnabled: item.isEnabled,
            destination: item.destination?.trim() || null,
          },
          update: {
            isEnabled: item.isEnabled,
            // undefined = giữ nguyên destination cũ; chuỗi rỗng = xoá override.
            ...(item.destination !== undefined ? { destination: item.destination.trim() || null } : {}),
          },
        }),
      ),
    );
    return this.getPreferences(userId);
  }

  /**
   * Ghi thông báo đa kênh có tôn trọng NotificationPreference. Trả về số bản ghi đã tạo.
   * Kênh bị tắt / không có phương tiện liên hệ được bỏ qua âm thầm.
   */
  async enqueue(input: EnqueueNotificationInput): Promise<number> {
    const channels = input.channels ?? [...NOTIFICATION_CHANNELS];
    const isFuture = Boolean(input.scheduledAt && input.scheduledAt.getTime() > Date.now());
    let created = 0;

    for (const channel of channels) {
      if (channel === 'sms' && !SMS_MILESTONE_TYPES.includes(input.notificationType)) continue; // SMS có chi phí
      const resolution = await this.contactResolver.resolve(input.recipient, channel, input.notificationType);
      if (!resolution.allowed) continue;

      const sendNow = channel === 'in_app' && !isFuture;
      await this.prisma.notification.create({
        data: {
          recipientUserId: input.recipient.userId,
          recipientPatientId: input.recipient.patientId,
          notificationType: input.notificationType,
          channel,
          referenceType: input.referenceType,
          referenceId: input.referenceId,
          title: input.title,
          content: input.content,
          status: sendNow ? NOTIFICATION_STATUS.SENT : NOTIFICATION_STATUS.QUEUED,
          sentAt: sendNow ? new Date() : null,
          scheduledAt: input.scheduledAt ?? null,
        },
      });
      created += 1;
    }
    return created;
  }
}
