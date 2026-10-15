import { Injectable, Logger } from '@nestjs/common';

/**
 * Cổng (port) gửi email — tách interface riêng để module Prescription KHÔNG phụ thuộc
 * trực tiếp vào hạ tầng email thật (SMTP/SES/SendGrid...), cùng kiểu thiết kế đã dùng ở
 * payment/notification/ports/email-sender.port.ts.
 */
export const EMAIL_SENDER_PORT = 'PRESCRIPTION_EMAIL_SENDER_PORT';

export interface EmailSenderPort {
    sendEmail(to: string, subject: string, body: string): Promise<void>;
}

/**
 * Cài đặt mặc định — CHƯA gọi hạ tầng email thật, chỉ log lại (giống default adapter
 * đang dùng ở payment/notification).
 * TODO: thay bằng adapter thật (SMTP/SES/SendGrid... của hệ thống) trước khi lên production.
 */
@Injectable()
export class DefaultEmailSenderAdapter implements EmailSenderPort {
    private readonly logger = new Logger(DefaultEmailSenderAdapter.name);

    async sendEmail(to: string, subject: string, body: string): Promise<void> {
        this.logger.warn(`[STUB] Chưa cấu hình email thật — bỏ qua gửi email tới ${to} (subject: "${subject}").`);
    }
}
