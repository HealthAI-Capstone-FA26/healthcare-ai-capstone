/** Phát khi 1 EcgAiAnalysis được xếp hàng ('queued'); EcgAnalysisListener chạy nó ở nền. */
export class EcgAnalysisQueuedEvent {
    constructor(public readonly analysisId: string) {}
}

export const ECG_ANALYSIS_QUEUED_EVENT = 'ecg-analysis.queued';
