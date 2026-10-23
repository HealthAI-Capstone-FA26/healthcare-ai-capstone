/**
 * Event phát ra ngay sau khi PrescriptionSigningService.sign() ký thành công (status
 * draft -> signed). Coi "đồng bộ Dược/Thanh toán" = đã phát event này (§ Phase 5 kế hoạch
 * module 9) — phần xử lý thực tế phía Dược/Thanh toán sẽ implement khi các module đó
 * được xây (Module 6 hiện mới có scaffold DTO/port, chưa có invoice.service.ts thật).
 *
 * Khi Module 6 (Thanh toán) được code, InvoiceService chỉ cần @OnEvent(PRESCRIPTION_SIGNED_EVENT)
 * và inject PrescriptionInvoiceItemsPort (xem port cùng thư mục ports/) để lấy danh sách dòng
 * cần lên hoá đơn — không cần sửa lại prescription-signing.service.ts.
 */
export class PrescriptionSignedEvent {
    constructor(
        public readonly prescriptionId: string,
        public readonly encounterId: string,
        public readonly patientId: string,
    ) {}
}

export const PRESCRIPTION_SIGNED_EVENT = 'prescription.signed';
