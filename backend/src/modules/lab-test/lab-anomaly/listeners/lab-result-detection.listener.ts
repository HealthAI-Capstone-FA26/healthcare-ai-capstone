import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LabResultDetectionOrchestrator } from '../orchestrators/lab-result-detection.orchestrator';
import { LabResultSubmittedEvent, LAB_RESULT_SUBMITTED_EVENT } from '../events/lab-result-submitted.event';
import { LabAlertGateway } from '../lab-alert.gateway';
import { LabPatientContextResolver } from '../resolvers/lab-patient-context.resolver';
import { AiLabAnalysisService } from '../../lab-ai-analysis/ai-lab-analysis.service';
import { LabCompletionNotificationService } from '../../lab-completion/lab-completion-notification.service';

/**
 * Lắng nghe 'lab-result.submitted' và điều phối toàn bộ xử lý nền (fire-and-forget,
 * không block API nhập kết quả của kỹ thuật viên):
 *   1. Chạy detection (rule + ai) -> cập nhật isAbnormal + tạo LabResultAlert -> push realtime.
 *   2. Đẩy dữ liệu sang khung AI phân tích (khoanh vùng/chẩn đoán hỗ trợ) — hiện là stub.
 *   3. Kiểm tra nếu đây là kết quả cuối cùng còn thiếu của lượt khám -> gửi Notification.
 * Mọi lỗi phải được catch + log riêng cho từng bước — lỗi ở bước này không được làm hỏng bước khác.
 */
@Injectable()
export class LabResultDetectionListener {
    private readonly logger = new Logger(LabResultDetectionListener.name);

    constructor(
        private readonly orchestrator: LabResultDetectionOrchestrator,
        private readonly alertGateway: LabAlertGateway,
        private readonly patientContextResolver: LabPatientContextResolver,
        private readonly aiLabAnalysisService: AiLabAnalysisService,
        private readonly completionNotificationService: LabCompletionNotificationService,
    ) { }

    @OnEvent(LAB_RESULT_SUBMITTED_EVENT, { async: true })
    async handleLabResultSubmitted(event: LabResultSubmittedEvent): Promise<void> {
        await this.runDetection(event.labResultId);
        await this.runAiAnalysis(event.labResultId);
        await this.runCompletionCheck(event.labResultId);
    }

    private async runDetection(labResultId: string): Promise<void> {
        try {
            const results = await this.orchestrator.run(labResultId);
            const abnormalCount = results.filter((r) => r.isAbnormal).length;
            this.logger.log(`Detection xong cho lab result ${labResultId}: ${abnormalCount}/${results.length} bất thường`);

            const patientContext = await this.patientContextResolver.resolve(labResultId);
            this.alertGateway.pushAlertUpdate({
                labResultId,
                encounterId: patientContext.encounterId,
                totalValues: results.length,
                abnormalCount,
                results,
            });
        } catch (err) {
            this.logger.error(`Detection thất bại cho lab result ${labResultId}: ${(err as Error).message}`, (err as Error).stack);
        }
    }

    private async runAiAnalysis(labResultId: string): Promise<void> {
        try {
            await this.aiLabAnalysisService.enqueueAnalysis(labResultId);
        } catch (err) {
            this.logger.error(`Đẩy AI lab analysis thất bại cho ${labResultId}: ${(err as Error).message}`, (err as Error).stack);
        }
    }

    private async runCompletionCheck(labResultId: string): Promise<void> {
        try {
            await this.completionNotificationService.checkAndNotifyIfComplete(labResultId);
        } catch (err) {
            this.logger.error(
                `Kiểm tra hoàn tất/gửi thông báo thất bại cho lab result ${labResultId}: ${(err as Error).message}`,
                (err as Error).stack,
            );
        }
    }
}
