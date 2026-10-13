import { Injectable, Logger } from '@nestjs/common';

/**
 * Cổng (port) gửi email — tách interface riêng để module Lab-test KHÔNG phụ thuộc trực tiếp
 * vào hạ tầng email thật (SMTP/SES/SendGrid...), cùng kiểu thiết kế đã dùng ở
 * payment-verification.port.ts. Khi tích hợp thật, bind provider khác (adapter dùng chung
 * của toàn hệ thống, VD common/email) vào token EMAIL_SENDER_PORT thay cho adapter mặc định.
 */
export const EMAIL_SENDER_PORT = 'EMAIL_SENDER_PORT';

export interface EmailSenderPort {
    sendEmail(to: string, subject: string, body: string): Promise<void>;
}

/**
 * Cài đặt mặc định — CHƯA gọi hạ tầng email thật, chỉ log lại.
 * TODO: thay bằng adapter thật (dùng SMTP/SES/SendGrid... của hệ thống) trước khi lên production.
 */
@Injectable()
export class DefaultEmailSenderAdapter implements EmailSenderPort {
    private readonly logger = new Logger(DefaultEmailSenderAdapter.name);

    async sendEmail(to: string, subject: string, body: string): Promise<void> {
        this.logger.warn(`[STUB] Chưa cấu hình email thật — bỏ qua gửi email tới ${to} (subject: "${subject}").`);
    }
}
