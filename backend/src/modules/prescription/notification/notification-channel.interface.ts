export type NotificationChannel = 'email';

/**
 * Thông tin liên hệ của người nhận — resolve trước khi gọi dispatcher, để strategy không
 * cần tự tra cứu quan hệ Patient/User (cùng kiểu thiết kế đã dùng ở
 * payment/notification/notification-channel.interface.ts).
 */
export interface NotificationRecipient {
    userId?: string;
    patientId?: string;
    /** Bắt buộc nếu muốn gửi qua kênh 'email'. */
    email?: string;
}

export interface NotificationPayload {
    recipient: NotificationRecipient;
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
