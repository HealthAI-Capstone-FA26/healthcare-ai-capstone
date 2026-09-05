/**
 * Event emit ngay sau khi 1 LabResult (kèm giá trị) được lưu DB thành công — dù là lần
 * nhập đầu tiên hay lần đính chính. Ba việc chạy nền (không block API) đều lắng nghe event này:
 *   1. LabResultDetectionListener  — phát hiện bất thường + tạo LabResultAlert.
 *   2. AiLabAnalysisService        — đẩy dữ liệu sang khung AI phân tích (stub).
 *   3. LabCompletionNotificationService — kiểm tra & báo hoàn tất nếu đủ kết quả.
 */
export class LabResultSubmittedEvent {
    constructor(public readonly labResultId: string) {}
}

export const LAB_RESULT_SUBMITTED_EVENT = 'lab-result.submitted';
