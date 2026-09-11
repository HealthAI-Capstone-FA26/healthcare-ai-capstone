import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Cổng (port) kiểm tra tình trạng thanh toán của 1 order item xét nghiệm.
 * Tách interface riêng để module Lab-test KHÔNG phụ thuộc trực tiếp vào chi tiết
 * schema của module Hoá đơn/Thanh toán (Invoice/Payment) — chỉ cần biết "đã thanh
 * toán hay chưa". Khi tích hợp thật, implement lại DefaultPaymentVerificationAdapter
 * (hoặc bind 1 provider khác vào token PAYMENT_VERIFICATION_PORT) để trỏ đúng vào
 * bảng Invoice/InvoiceItem/Payment thực tế của hệ thống.
 */
export const PAYMENT_VERIFICATION_PORT = 'PAYMENT_VERIFICATION_PORT';

export interface PaymentVerificationPort {
    /** Trả về true nếu order item xét nghiệm đã được thanh toán đầy đủ. */
    isOrderItemPaid(orderItemId: string): Promise<boolean>;
}

/**
 * Cài đặt mặc định — hiện đọc trực tiếp cờ `paymentVerified` do event/webhook thanh toán
 * ghi vào LabTask (xem LabTaskService.verifyPayment). Đây là nguồn sự thật đơn giản, phù hợp
 * khi module Thanh toán chủ động gọi API verify-payment sau khi hoá đơn được thanh toán.
 *
 * TODO: nếu muốn Lab-test tự tra cứu trạng thái hoá đơn thay vì chờ webhook, đổi cài đặt này
 * để join sang Invoice/InvoiceItem theo orderItemId (VD: kiểm tra invoiceItem.invoice.status === 'paid').
 */
@Injectable()
export class DefaultPaymentVerificationAdapter implements PaymentVerificationPort {
    constructor(private readonly prisma: PrismaService) {}

    async isOrderItemPaid(orderItemId: string): Promise<boolean> {
        const task = await this.prisma.labTask.findUnique({
            where: { orderItemId },
            select: { paymentVerified: true },
        });
        return !!task?.paymentVerified;
    }
}
