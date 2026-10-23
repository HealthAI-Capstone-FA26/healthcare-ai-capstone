/** Khớp Notification.channel trong schema: email | sms | zalo_oa | in_app. */
export const NOTIFICATION_CHANNELS = ['in_app', 'email', 'sms', 'zalo_oa'] as const;
export type NotificationChannelCode = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * Khớp Notification.notificationType (xem comment trong schema.prisma). '*' chỉ dùng cho
 * NotificationPreference.notificationType = áp dụng mọi loại.
 */
export const NOTIFICATION_TYPES = [
  'registration_confirmed',
  'queue_called',
  'invoice_issued',
  'payment_success',
  'diagnostics_completed',
  'critical_value_alert',
  'ecg_anomaly_alert',
  'prescription_ready',
  'follow_up_reminder',
  'appointment_reminder',
] as const;
export type NotificationTypeCode = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_TYPE_WILDCARD = '*';

/**
 * SMS có chi phí -> chỉ gửi ở các mốc quan trọng theo Registration SE07 (xác nhận đăng ký, tới lượt khám,
 * có kết quả xét nghiệm, đơn thuốc sẵn sàng) + nhắc hẹn. Email / in_app / Zalo OA không giới hạn.
 */
export const SMS_MILESTONE_TYPES: readonly string[] = [
  'registration_confirmed',
  'queue_called',
  'diagnostics_completed',
  'prescription_ready',
  'follow_up_reminder',
  'appointment_reminder',
];

export const NOTIFICATION_STATUS = {
  QUEUED: 'queued',
  SENT: 'sent',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
} as const;

/** Lý do worker huỷ (ghi vào Notification.errorMessage) — không phải lỗi gửi nên KHÔNG đặt status 'failed'. */
export const NOTIFICATION_CANCEL_REASON = {
  DISABLED_BY_PREFERENCE: 'DISABLED_BY_PREFERENCE',
  NO_CONTACT: 'NO_CONTACT',
  NO_RECIPIENT: 'NO_RECIPIENT',
} as const;
