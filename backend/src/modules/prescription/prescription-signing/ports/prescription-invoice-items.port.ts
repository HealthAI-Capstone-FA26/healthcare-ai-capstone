import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';

/**
 * Cổng (port) cho module Thanh toán (chưa được xây — xem note ở prescription-signed.event.ts)
 * lấy danh sách dòng cần lên hoá đơn từ 1 đơn thuốc đã ký — tách interface riêng để
 * module Prescription không phụ thuộc ngược vào invoice.service.ts, cùng kiểu thiết kế đã
 * dùng ở payment/invoice/ports/lab-task-payment-notifier.port.ts (theo chiều ngược lại).
 *
 * Khi InvoiceService được code, inject PRESCRIPTION_INVOICE_ITEMS_PORT (PrescriptionModule
 * đã export) để gọi getInvoiceItems() ngay khi xử lý PrescriptionSignedEvent, không cần
 * sửa lại module prescription lúc đó.
 */
export const PRESCRIPTION_INVOICE_ITEMS_PORT = 'PRESCRIPTION_INVOICE_ITEMS_PORT';

export interface PrescriptionInvoiceItemLine {
    description: string;
    quantity: number;
    unitPrice: number;
}

export interface PrescriptionInvoiceItemsPort {
    /** Danh sách dòng thuốc (kèm unitPrice snapshot lúc kê) để lên hoá đơn cho 1 đơn thuốc đã ký. */
    getInvoiceItems(prescriptionId: string): Promise<PrescriptionInvoiceItemLine[]>;
}

@Injectable()
export class PrescriptionInvoiceItemsAdapter implements PrescriptionInvoiceItemsPort {
    constructor(private readonly prisma: PrismaService) {}

    async getInvoiceItems(prescriptionId: string): Promise<PrescriptionInvoiceItemLine[]> {
        const prescription = await this.prisma.prescription.findUnique({
            where: { prescriptionId },
            select: {
                items: {
                    include: { drug: { select: { drugName: true, strength: true, unit: true } } },
                },
            },
        });

        if (!prescription) {
            throw new NotFoundException('Không tìm thấy đơn thuốc');
        }

        // unitPrice lấy snapshot đã lưu trên PrescriptionItem tại thời điểm kê (không đọc lại
        // DrugCatalog.price hiện tại), đúng quyết định "snapshot giá" đã chốt ở Phase 2.
        return prescription.items.map((item) => ({
            description: `${item.drug.drugName} (${item.drug.strength}) x${item.quantity} ${item.drug.unit}`,
            quantity: Number(item.quantity),
            unitPrice: Number(item.unitPrice),
        }));
    }
}
