export type NotificationChannel = 'in_app' | 'email' | 'push';

/**
 * Thông tin liên hệ của người nhận — resolve trước khi gọi dispatcher, để từng strategy
 * không cần tự tra cứu quan hệ User/Patient (schema các model đó nằm ngoài phạm vi module
 * lab-test, xem ghi chú tương tự ở lab-result-detector.interface.ts).
 */
export interface NotificationRecipient {
    userId?: string;
    patientId?: string;
    /** Bắt buộc nếu muốn gửi qua kênh 'email'. */
    email?: string;
    /** Bắt buộc nếu muốn gửi qua kênh 'push'. */
    pushToken?: string;
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
