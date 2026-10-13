/** Khớp Notification.channel trong schema: email | sms | zalo_oa | in_app (không còn 'push'). */
export type NotificationChannel = 'in_app' | 'email' | 'sms' | 'zalo_oa';

/**
 * Người nhận — resolve trước khi gọi dispatcher để từng strategy không tự tra cứu quan hệ User/Patient.
 */
export interface NotificationRecipient {
    userId?: string;
    patientId?: string;
    /** Bắt buộc nếu gửi qua kênh 'email'. */
    email?: string;
}

export interface NotificationPayload {
    recipient: NotificationRecipient;
    /** Khớp Notification.notificationType: diagnostics_completed | critical_value_alert | ecg_anomaly_alert | ... */
    notificationType: string;
    referenceType: string;
    referenceId: string;
    title: string;
    content: string;
}

export interface NotificationChannelStrategy {
    readonly channel: NotificationChannel;
    send(payload: NotificationPayload): Promise<void>;
}
