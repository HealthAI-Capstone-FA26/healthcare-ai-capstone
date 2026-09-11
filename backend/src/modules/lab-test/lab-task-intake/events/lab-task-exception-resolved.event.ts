import { LabTaskExceptionResolution } from '../dtos/resolve-lab-task-exception.dto';

/**
 * Phát ra sau khi bác sĩ đã quyết định xong một ngoại lệ đang 'on_hold' (xem
 * LabTaskService.resolveException). Khác với LabTaskExceptionReportedEvent (tín hiệu "cần quyết
 * định"), event này là tín hiệu "đã quyết định xong" — dùng để Notification báo lại cho phòng Lab
 * biết bước tiếp theo (lấy lại mẫu hay dừng hẳn), tránh phòng Lab phải tự poll trạng thái.
 */
export class LabTaskExceptionResolvedEvent {
    constructor(
        public readonly labTaskId: string,
        public readonly orderItemId: string,
        public readonly labRoomId: string,
        public readonly decision: LabTaskExceptionResolution,
        public readonly reason: string | undefined,
        public readonly resolvedByUserId: string | undefined,
    ) { }
}

export const LAB_TASK_EXCEPTION_RESOLVED_EVENT = 'lab-task.exception-resolved';
