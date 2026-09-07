import { LabTaskExceptionReason } from '../dtos/report-lab-task-exception.dto';

/**
 * Phát ra ngay sau khi phòng Lab báo cáo không thể tiếp tục 1 nhiệm vụ xét nghiệm
 * (status -> 'on_hold'). Đây chỉ là TÍN HIỆU CẦN QUYẾT ĐỊNH, không phải kết quả cuối cùng.
 *
 * Các module nên lắng nghe (nằm ngoài phạm vi module Lab, liệt kê để tham khảo khi nối dây):
 *   - Notification: báo ngay cho bác sĩ chỉ định biết để chủ động quyết định.
 *   - Order: hiển thị nhiệm vụ này trong danh sách "cần bác sĩ xử lý" gắn với order item.
 *
 * LabTask sẽ đứng yên ở 'on_hold' cho tới khi nhận được quyết định từ bác sĩ/module Order, thông
 * qua một trong hai đường: OrderItemCancelledEvent (huỷ hẳn, cascade từ module Order thật) hoặc
 * POST /lab-tasks/:id/resolve-exception — xem LabTaskService.resolveException và
 * LabTaskExceptionResolvedEvent (event phát ra SAU khi đã có quyết định).
 */
export class LabTaskExceptionReportedEvent {
    constructor(
        public readonly labTaskId: string,
        public readonly orderItemId: string,
        public readonly labRoomId: string,
        public readonly reasonCode: LabTaskExceptionReason,
        public readonly detail: string | undefined,
        public readonly reportedByUserId: string | undefined,
    ) { }
}

export const LAB_TASK_EXCEPTION_REPORTED_EVENT = 'lab-task.exception-reported';
