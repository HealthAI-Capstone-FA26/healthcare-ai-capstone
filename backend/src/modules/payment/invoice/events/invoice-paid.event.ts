export const INVOICE_PAID_EVENT = 'invoice.paid';

/**
 * §3.4 bước 4 — emit sau khi 1 Invoice chuyển sang 'paid' (markPaidIfSettled), để việc dispatch
 * Notification 'payment_success' chạy tách khỏi luồng chính (không block response API xác nhận
 * thanh toán). Listener riêng: InvoicePaidListener.
 */
export class InvoicePaidEvent {
  constructor(
    public readonly invoiceId: string,
    public readonly patientId: string,
  ) {}
}
