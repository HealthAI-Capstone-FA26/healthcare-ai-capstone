import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
  NOTIFICATION_CANCEL_REASON,
  NOTIFICATION_TYPE_WILDCARD,
  NotificationChannelCode,
} from './notification.constants';

export interface ContactRecipient {
  userId?: string | null;
  patientId?: string | null;
}

export interface ContactResolution {
  /** false = không được/không thể gửi qua kênh này (xem `reason`). */
  allowed: boolean;
  reason?: string;
  /** Email / số điện thoại / Zalo user id. Kênh in_app không cần. */
  destination?: string;
  /** userId hiệu lực (kể cả suy ra từ Patient.userId) — dùng tra NotificationPreference. */
  userId?: string;
}

/**
 * Nguồn duy nhất quyết định "gửi tới đâu & có được gửi không" cho 1 (người nhận, kênh, loại thông báo):
 *  - NotificationPreference (ưu tiên dòng đúng loại, rồi tới dòng '*'): isEnabled=false -> không gửi;
 *    `destination` ghi đè email / SĐT / Zalo user id mặc định.
 *  - Mặc định: email = Patient.email ?? User.email; sms = Patient.phoneNumber ?? UserProfile.phoneNumber;
 *    zalo_oa chỉ gửi khi người nhận đã khai báo destination (Zalo user id) trong preference.
 */
@Injectable()
export class NotificationContactResolver {
  constructor(private readonly prisma: PrismaService) { }

  async resolve(
    recipient: ContactRecipient,
    channel: NotificationChannelCode,
    notificationType: string,
  ): Promise<ContactResolution> {
    if (!recipient.userId && !recipient.patientId) {
      return { allowed: false, reason: NOTIFICATION_CANCEL_REASON.NO_RECIPIENT };
    }

    const patient = recipient.patientId
      ? await this.prisma.patient.findUnique({
        where: { patientId: recipient.patientId },
        select: { userId: true, phoneNumber: true, email: true },
      })
      : null;

    const userId = recipient.userId ?? patient?.userId ?? undefined;

    const user = userId
      ? await this.prisma.user.findUnique({
        where: { userId },
        select: { email: true, profile: { select: { phoneNumber: true } } },
      })
      : null;

    const preferences = userId
      ? await this.prisma.notificationPreference.findMany({
        where: { userId, channel, notificationType: { in: [notificationType, NOTIFICATION_TYPE_WILDCARD] } },
      })
      : [];
    const preference =
      preferences.find((p) => p.notificationType === notificationType) ??
      preferences.find((p) => p.notificationType === NOTIFICATION_TYPE_WILDCARD);

    if (preference && !preference.isEnabled) {
      return { allowed: false, reason: NOTIFICATION_CANCEL_REASON.DISABLED_BY_PREFERENCE, userId };
    }

    if (channel === 'in_app') {
      return { allowed: true, userId };
    }

    let destination: string | undefined = preference?.destination?.trim() || undefined;
    if (!destination) {
      if (channel === 'email') destination = patient?.email ?? user?.email ?? undefined;
      if (channel === 'sms') destination = patient?.phoneNumber ?? user?.profile?.phoneNumber ?? undefined;
      // zalo_oa: không có mặc định — Zalo user id phải do người dùng khai báo.
    }

    if (!destination) {
      return { allowed: false, reason: NOTIFICATION_CANCEL_REASON.NO_CONTACT, userId };
    }
    return { allowed: true, destination, userId };
  }
}
