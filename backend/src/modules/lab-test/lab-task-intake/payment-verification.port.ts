import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Cổng kiểm tra tình trạng thanh toán của 1 hạng mục chỉ định. Tách interface để lab-test KHÔNG phụ thuộc cứng vào
 * module Hoá đơn/Thanh toán — chỉ cần biết "đã thanh toán hay chưa".
 */
export const PAYMENT_VERIFICATION_PORT = 'PAYMENT_VERIFICATION_PORT';

export interface PaymentVerificationPort {
    /** Trả về true nếu hạng mục chỉ định đã được thanh toán đầy đủ. */
    isOrderItemPaid(orderItemId: string): Promise<boolean>;
}

/**
 * Cài đặt mặc định — phòng thủ 2 lớp: tin cờ `DiagnosticTask.paymentVerified` (do SE03 gọi verifyPayment), HOẶC
 * tra trực tiếp hoá đơn: InvoiceItem.orderItemId -> Invoice.status = 'paid'. Lớp thứ 2 chỉ chạy khi cờ chưa bật
 * (vd. webhook thanh toán chưa kịp báo), chỉ ĐỌC — không ghi cờ.
 */
@Injectable()
export class DefaultPaymentVerificationAdapter implements PaymentVerificationPort {
    constructor(private readonly prisma: PrismaService) {}

    async isOrderItemPaid(orderItemId: string): Promise<boolean> {
        const task = await this.prisma.diagnosticTask.findUnique({
            where: { orderItemId },
            select: { paymentVerified: true },
        });
        if (task?.paymentVerified) return true;

        const invoiceItem = await this.prisma.invoiceItem.findUnique({
            where: { orderItemId },
            select: { invoice: { select: { status: true } } },
        });
        return invoiceItem?.invoice.status === 'paid';
    }
}
