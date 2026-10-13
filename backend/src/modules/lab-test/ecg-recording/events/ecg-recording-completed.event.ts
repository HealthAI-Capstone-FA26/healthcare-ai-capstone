/**
 * Phát SAU khi 1 EcgRecording được lưu thành công (status 'completed'). EcgAnalysisListener lắng nghe để xếp hàng
 * phân tích AI chạy nền (nếu autoAnalyze) — API upload không phải chờ AI.
 */
export class EcgRecordingCompletedEvent {
    constructor(
        public readonly ecgRecordingId: string,
        public readonly autoAnalyze: boolean,
    ) {}
}

export const ECG_RECORDING_COMPLETED_EVENT = 'ecg-recording.completed';
