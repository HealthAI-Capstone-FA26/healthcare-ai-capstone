/**
 * Sự kiện được PHÁT RA bởi module Order (doctor-examination/test-order — Module 5), ngay khi bác
 * sĩ điều trị chính thức huỷ một chỉ định xét nghiệm (TestOrderItem).
 *
 * Module Lab (lab-test) chỉ LẮNG NGHE (xem LabTaskOrderCancellationListener) — không tự phát sự
 * kiện này. Đây là điểm cốt lõi của thiết kế: quyền quyết định "không cần xét nghiệm nữa" thuộc
 * về bác sĩ/module Order, không thuộc về phòng Lab.
 *
 * ĐÂY LÀ NGUỒN CHÂN LÝ (source of truth) — trước khi module Order (Module 5) được triển khai,
 * class này từng được khai báo tạm ở `lab-test/lab-task-intake/events/order-item-cancelled.event.ts`
 * (nay chỉ còn re-export từ đây để không phải sửa các import hiện có trong module lab-test).
 */
export class OrderItemCancelledEvent {
    constructor(
        public readonly orderItemId: string,
        public readonly cancelledByUserId: string,
        public readonly reason?: string,
    ) {}
}

export const ORDER_ITEM_CANCELLED_EVENT = 'order-item.cancelled';
