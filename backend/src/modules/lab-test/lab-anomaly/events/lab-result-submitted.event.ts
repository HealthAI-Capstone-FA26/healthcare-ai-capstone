/**
 * Phát ngay sau khi 1 DiagnosticResult được lưu/sửa thành công (SAU khi commit). Các việc chạy nền (không block API):
 *   1. LabResultDetectionListener — phát hiện bất thường (rule-based) + cập nhật ResultValueAlert.
 *   2. LabCompletionNotificationService — báo hoàn tất cho bác sĩ/bệnh nhân khi `notifyCompletion = true`.
 *
 * `notifyCompletion` = true CHỈ khi lần nộp này đưa Encounter vào 'awaiting_review' (mọi cận lâm sàng đã xong),
 * do DiagnosticProgressService xác định trong cùng transaction — nhờ vậy sửa/đính chính kết quả không gửi lại
 * thông báo hoàn tất, còn chỉ định bổ sung sau đó vẫn gửi được lần mới.
 *
 * Tên event/field `labResultId` giữ nguyên (nay chính là DiagnosticResult.resultId).
 */
export class LabResultSubmittedEvent {
    constructor(
        public readonly labResultId: string,
        public readonly notifyCompletion: boolean = false,
    ) {}
}

export const LAB_RESULT_SUBMITTED_EVENT = 'lab-result.submitted';
