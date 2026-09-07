/**
 * CONTRACT — sự kiện được PHÁT RA bởi module Order/Encounter (nằm ngoài phạm vi module Lab này),
 * ngay khi bác sĩ điều trị chính thức huỷ một chỉ định xét nghiệm (TestOrderItem).
 *
 * Module Lab chỉ LẮNG NGHE (xem LabTaskOrderCancellationListener) — không tự phát sự kiện này.
 * Đây là điểm cốt lõi của thiết kế: quyền quyết định "không cần xét nghiệm nữa" thuộc về bác sĩ/
 * module Order, không thuộc về phòng Lab. `LabTaskService` không còn action `cancel()` chủ động nữa.
 *
 * Khi triển khai module Order thực tế, định nghĩa class + hằng số tên event này nên chuyển về đó
 * làm nguồn chân lý (source of truth); khai báo lại ở đây chỉ để LabTaskOrderCancellationListener
 * có kiểu dữ liệu tường minh trong lúc chưa có module Order.
 */
export class OrderItemCancelledEvent {
    constructor(
        public readonly orderItemId: string,
        public readonly cancelledByUserId: string,
        public readonly reason?: string,
    ) {}
}

export const ORDER_ITEM_CANCELLED_EVENT = 'order-item.cancelled';
