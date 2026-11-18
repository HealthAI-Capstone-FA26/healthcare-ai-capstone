import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LabResultDetectionOrchestrator, NOTIFY_RISK_LEVELS } from '../orchestrators/lab-result-detection.orchestrator';
import { LabResultSubmittedEvent, LAB_RESULT_SUBMITTED_EVENT } from '../events/lab-result-submitted.event';
import { LabAlertGateway } from '../lab-alert.gateway';
import { LabCompletionNotificationService } from '../../lab-completion/lab-completion-notification.service';
import { NotificationDispatcherService } from '../../notification/notification-dispatcher.service';

/**
 * Lắng nghe 'lab-result.submitted' và điều phối xử lý nền (không block API nhập kết quả):
 *   1. Detection rule-based -> đồng bộ ResultValueAlert -> push realtime -> thông báo critical_value_alert cho bác sĩ.
 *   2. Nếu lần nộp này đưa encounter vào 'awaiting_review' -> thông báo hoàn tất.
 * Mỗi bước catch + log riêng — lỗi bước này không làm hỏng bước kia.
 */
@Injectable()
export class LabResultDetectionListener {
    private readonly logger = new Logger(LabResultDetectionListener.name);

    constructor(
        private readonly orchestrator: LabResultDetectionOrchestrator,
        private readonly alertGateway: LabAlertGateway,
        private readonly completionNotificationService: LabCompletionNotificationService,
        private readonly dispatcher: NotificationDispatcherService,
    ) {}

    @OnEvent(LAB_RESULT_SUBMITTED_EVENT, { async: true })
    async handleLabResultSubmitted(event: LabResultSubmittedEvent): Promise<void> {
        await this.runDetection(event.labResultId);
        if (event.notifyCompletion) {
            await this.runCompletionNotification(event.labResultId);
        }
    }

    private async runDetection(resultId: string): Promise<void> {
        try {
            const { results, newAlerts, encounterId, doctorUserId } = await this.orchestrator.run(resultId);
            const abnormalCount = results.filter((r) => r.isAbnormal).length;
            this.logger.log(`Detection xong cho kết quả ${resultId}: ${abnormalCount}/${results.length} bất thường`);

            this.alertGateway.pushAlertUpdate({
                labResultId: resultId,
                encounterId,
                totalValues: results.length,
                abnormalCount,
                results,
            });

            if (doctorUserId) {
                for (const alert of newAlerts.filter((a) => NOTIFY_RISK_LEVELS.includes(a.riskLevel))) {
                    await this.dispatcher.dispatch(
                        {
                            recipient: { userId: doctorUserId },
                            notificationType: 'critical_value_alert',
                            referenceType: 'result_value_alert',
                            referenceId: alert.alertId,
                            title: 'Cảnh báo giá trị cận lâm sàng nguy kịch',
                            content: `Chỉ số '${alert.parameterName}' ở mức nguy kịch (lượt khám ${encounterId}). Cần xem xét ngay.`,
                        },
                        ['in_app'],
                    );
                }
            }
        } catch (err) {
            this.logger.error(`Detection thất bại cho kết quả ${resultId}: ${(err as Error).message}`, (err as Error).stack);
        }
    }

    private async runCompletionNotification(resultId: string): Promise<void> {
        try {
            await this.completionNotificationService.notifyForResult(resultId);
        } catch (err) {
            this.logger.error(`Gửi thông báo hoàn tất thất bại cho kết quả ${resultId}: ${(err as Error).message}`, (err as Error).stack);
        }
    }
}
