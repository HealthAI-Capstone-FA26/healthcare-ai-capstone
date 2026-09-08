import { Injectable, Logger } from '@nestjs/common';

/**
 * Cổng (port) gửi push notification (FCM/APNs...). Cùng kiểu thiết kế với EmailSenderPort.
 * Đây là kênh ƯU TIÊN THẤP HƠN email/in-app theo yêu cầu nghiệp vụ hiện tại — để dạng stub,
 * bind provider thật vào token PUSH_SENDER_PORT khi cần triển khai đầy đủ.
 */
export const PUSH_SENDER_PORT = 'PUSH_SENDER_PORT';

export interface PushSenderPort {
    sendPush(deviceToken: string, title: string, body: string): Promise<void>;
}

/**
 * Cài đặt mặc định — CHƯA gọi hạ tầng push thật, chỉ log lại.
 * TODO: thay bằng adapter thật (FCM/APNs...) khi push được đưa vào triển khai chính thức.
 */
@Injectable()
export class DefaultPushSenderAdapter implements PushSenderPort {
    private readonly logger = new Logger(DefaultPushSenderAdapter.name);

    async sendPush(deviceToken: string, title: string, body: string): Promise<void> {
        this.logger.warn(`[STUB] Chưa cấu hình push thật — bỏ qua gửi push tới token ${deviceToken} (title: "${title}").`);
    }
}
