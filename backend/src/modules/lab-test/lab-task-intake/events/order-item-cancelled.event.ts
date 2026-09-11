/**
 * Module Order (doctor-examination/test-order — Module 5) đã được triển khai và là NGUỒN CHÂN LÝ
 * cho contract sự kiện này — xem `src/modules/doctor-examination/test-order/events/order-item-cancelled.event.ts`.
 *
 * File này chỉ còn re-export để giữ nguyên đường import hiện có trong module lab-test
 * (LabTaskOrderCancellationListener), tránh phải sửa lại các chỗ đã dùng.
 */
export {
    OrderItemCancelledEvent,
    ORDER_ITEM_CANCELLED_EVENT,
} from '../../../pre-doctor-examination/test-order/events/order-item-cancelled.event';
