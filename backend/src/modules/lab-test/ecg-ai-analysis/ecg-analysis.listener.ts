import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ECG_RECORDING_COMPLETED_EVENT, EcgRecordingCompletedEvent } from '../ecg-recording/events/ecg-recording-completed.event';
import { ECG_ANALYSIS_QUEUED_EVENT, EcgAnalysisQueuedEvent } from './events/ecg-analysis-queued.event';
import { EcgAnalysisService } from './ecg-analysis.service';

/**
 * Chạy phân tích AI ở NỀN, tách khỏi request upload/reanalyze:
 *   ecg-recording.completed -> (autoAnalyze) enqueue 'batch' -> ecg-analysis.queued -> run().
 * Mọi lỗi được catch + log: không bao giờ làm hỏng tiến trình hay luồng thủ công.
 */
@Injectable()
export class EcgAnalysisListener {
    private readonly logger = new Logger(EcgAnalysisListener.name);

    constructor(private readonly analysisService: EcgAnalysisService) {}

    @OnEvent(ECG_RECORDING_COMPLETED_EVENT, { async: true })
    async onRecordingCompleted(event: EcgRecordingCompletedEvent): Promise<void> {
        if (!event.autoAnalyze) return;
        try {
            await this.analysisService.enqueue(event.ecgRecordingId, 'batch');
        } catch (err) {
            this.logger.error(`Không xếp hàng được phân tích ECG cho bản ghi ${event.ecgRecordingId}: ${(err as Error).message}`);
        }
    }

    @OnEvent(ECG_ANALYSIS_QUEUED_EVENT, { async: true })
    async onAnalysisQueued(event: EcgAnalysisQueuedEvent): Promise<void> {
        try {
            await this.analysisService.run(event.analysisId);
        } catch (err) {
            this.logger.error(`Chạy phân tích ECG ${event.analysisId} gặp lỗi không lường trước: ${(err as Error).message}`, (err as Error).stack);
        }
    }
}
