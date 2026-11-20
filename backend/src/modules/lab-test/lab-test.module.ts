import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma/prisma.service';
import { installBigIntJsonSerializer } from '../../common/utils/bigint-json.util';
import { UserModule } from '../identity-access/user/user.module';

import { LabRoomController } from './lab-room-catalog/lab-room.controller';
import { LabRoomService } from './lab-room-catalog/lab-room.service';

import { LabTaskController } from './lab-task-intake/lab-task.controller';
import { LabTaskService } from './lab-task-intake/lab-task.service';
import { DiagnosticProgressService } from './lab-task-intake/diagnostic-progress.service';
import { DefaultPaymentVerificationAdapter, PAYMENT_VERIFICATION_PORT } from './lab-task-intake/payment-verification.port';
import { LabTaskOrderCancellationListener } from './lab-task-intake/listeners/lab-task-order-cancellation.listener';

import { LabResultController } from './lab-result-entry/lab-result.controller';
import { LabResultService } from './lab-result-entry/lab-result.service';

import { LabResultAlertController } from './lab-anomaly/lab-result-alert.controller';
import { LabResultAlertService } from './lab-anomaly/lab-result-alert.service';
import { LabResultDetectionOrchestrator } from './lab-anomaly/orchestrators/lab-result-detection.orchestrator';
import { RuleBasedLabDetector } from './lab-anomaly/detectors/rule-based.detector';
import { LabAlertGateway } from './lab-anomaly/lab-alert.gateway';
import { LabResultDetectionListener } from './lab-anomaly/listeners/lab-result-detection.listener';
import { LabPatientContextResolver } from './lab-anomaly/resolvers/lab-patient-context.resolver';

import { LabReferenceRangeController } from './lab-reference-range/lab-reference-range.controller';
import { LabReferenceRangeService } from './lab-reference-range/lab-reference-range.service';
import { ResultThresholdResolver } from './lab-reference-range/result-threshold.resolver';

import { EcgRecordingController } from './ecg-recording/ecg-recording.controller';
import { EcgDatasetCatalog } from './ecg-stream/ecg-dataset.catalog';
import { EcgStreamGateway } from './ecg-stream/ecg-stream.gateway';
import { EcgStreamService } from './ecg-stream/ecg-stream.service';
import { EcgRecordingService } from './ecg-recording/ecg-recording.service';
import { ECG_SIGNAL_STORAGE, MinioEcgSignalStorage } from './ecg-recording/ecg-signal-storage.port';

import { EcgAnalysisController } from './ecg-ai-analysis/ecg-analysis.controller';
import { EcgAnalysisService } from './ecg-ai-analysis/ecg-analysis.service';
import { EcgAnalysisListener } from './ecg-ai-analysis/ecg-analysis.listener';
import { EcgModelService } from './ecg-ai-analysis/ecg-model.service';
import { EcgAnomalyEventService } from './ecg-ai-analysis/ecg-anomaly-event.service';
import { ECG_ANOMALY_PROVIDER } from './ecg-ai-analysis/ecg-anomaly-provider.port';
import { HttpEcgAnomalyProvider, readEcgAiConfigFromEnv } from './ecg-ai-analysis/http-ecg-anomaly.provider';

import { LabCompletionNotificationService } from './lab-completion/lab-completion-notification.service';

import { DefaultEmailSenderAdapter, EMAIL_SENDER_PORT } from './notification/ports/email-sender.port';
import { InAppNotificationStrategy } from './notification/strategies/in-app-notification.strategy';
import { EmailNotificationStrategy } from './notification/strategies/email-notification.strategy';
import { SmsNotificationStrategy, ZaloOaNotificationStrategy } from './notification/strategies/queued-notification.strategy';
import { NotificationDispatcherService } from './notification/notification-dispatcher.service';

// Cột BigInt (DiagnosticResultAttachment.sizeBytes, EcgRecording.signalSizeBytes) cần serializer JSON.
installBigIntJsonSerializer();

/**
 * SE04 — Cận lâm sàng tại các phòng chức năng (xét nghiệm máu, ECG, siêu âm tim, X-quang).
 *
 * Luồng:
 *  1. SE02 (pre-doctor-examination) chốt chỉ định -> tạo DiagnosticOrderItem + DiagnosticTask 'payment_pending';
 *     Encounter -> 'awaiting_diagnostics'.
 *  2. SE03 (payment) gọi thẳng LabTaskService.verifyPayment (service-to-service, KHÔNG có endpoint HTTP) ->
 *     task 'ready', ghi readyAt.
 *  3. KTV (phân quyền theo DiagnosticStaffRoomAssignment) tiếp nhận (POST /lab-tasks/:id/receive) -> 'in_progress';
 *     Order 'in_progress', Encounter 'diagnostics_in_progress'.
 *  4. KTV nhập kết quả (POST /lab-tasks/:id/results) -> task 'completed'. Cùng transaction,
 *     DiagnosticProgressService tính lại Order ('completed' + completedAt) và Encounter ('awaiting_review' khi mọi
 *     task không-cancelled đã xong).
 *  5. Chạy nền (event 'lab-result.submitted'): phát hiện bất thường theo ngưỡng -> ResultValueAlert (+ thông báo
 *     critical_value_alert); khi encounter vào 'awaiting_review' -> thông báo 'diagnostics_completed'.
 *  6. Bác sĩ có thể đọc/duyệt kết quả (POST /lab-results/:id/review) và xác nhận/giải quyết cảnh báo.
 *
 * Huỷ chỉ định: SE02 phát 'order-item.cancelled' -> LabTaskOrderCancellationListener -> task 'cancelled' ->
 * DiagnosticProgressService (huỷ hết -> Encounter về 'in_progress').
 *
 * ECG + AI (Bước 2B): KTV tải bản ghi ECG (POST /lab-tasks/:id/ecg-recordings) -> lưu MinIO + metadata -> event
 * 'ecg-recording.completed' -> phân tích AI chạy NỀN qua EcgAnomalyProvider (HTTP tới dịch vụ Python) -> EcgAiAnalysis +
 * EcgAnomalyEvent -> realtime 'ecg-alert-update' + thông báo 'ecg_anomaly_alert' (bất thường >= high). AI lỗi/chưa cấu
 * hình chỉ làm analysis 'failed'/'skipped' — nhập kết quả ECG thủ công không bị chặn. Cấu hình: ECG_AI_BASE_URL,
 * ECG_AI_TIMEOUT_MS, ECG_AI_API_KEY.
 *
 * ECG stream realtime: socket '/ecg-stream' phát lại bản ghi ECG theo từng điểm — 'stream-ecg' (ecg-point) và
 * 'stream-ecg-anomaly' (ecg-point-anomaly, kèm isAnomaly 0/1 từ kết quả AI). Nguồn: file upload (.npy/.csv) · dataset
 * ECG_A..F (ECG_DATASET_DIR) · recordingId. Xem ecg-stream/ecg-stream.gateway.ts.
 *
 * AUTH: mọi controller gắn JwtAuthGuard cấp class. Actor lấy từ JWT, vai trò assert qua ActorRoleService
 * (LAB_STAFF cho API phòng thực hiện, DOCTOR cho resolve-exception/review, ADMIN cho phân công nhân sự).
 */
@Module({
    imports: [
        UserModule,
        // Xác thực JWT khi kết nối socket /lab-alerts (cùng JWT_SECRET với AuthModule).
        JwtModule.registerAsync({ inject: [ConfigService], useFactory: (config: ConfigService) => ({ secret: config.getOrThrow<string>('JWT_SECRET') }) }),
    ],
    controllers: [
        LabRoomController,
        LabTaskController,
        LabResultController,
        LabResultAlertController,
        LabReferenceRangeController,
        EcgRecordingController,
        EcgAnalysisController,
    ],
    providers: [
        PrismaService,
        LabRoomService,
        DiagnosticProgressService,
        LabTaskService,
        LabTaskOrderCancellationListener,
        { provide: PAYMENT_VERIFICATION_PORT, useClass: DefaultPaymentVerificationAdapter },
        LabResultService,
        ResultThresholdResolver,
        RuleBasedLabDetector,
        LabPatientContextResolver,
        LabResultDetectionOrchestrator,
        LabResultAlertService,
        LabAlertGateway,
        LabResultDetectionListener,
        LabReferenceRangeService,
        LabCompletionNotificationService,
        { provide: ECG_SIGNAL_STORAGE, useClass: MinioEcgSignalStorage },
        { provide: ECG_ANOMALY_PROVIDER, useFactory: () => new HttpEcgAnomalyProvider(readEcgAiConfigFromEnv()) },
        EcgRecordingService,
        EcgDatasetCatalog,
        EcgStreamService,
        EcgStreamGateway,
        EcgAnalysisService,
        EcgAnalysisListener,
        EcgAnomalyEventService,
        EcgModelService,
        { provide: EMAIL_SENDER_PORT, useClass: DefaultEmailSenderAdapter },
        InAppNotificationStrategy,
        EmailNotificationStrategy,
        SmsNotificationStrategy,
        ZaloOaNotificationStrategy,
        NotificationDispatcherService,
    ],
    exports: [LabTaskService, LabResultService, EcgRecordingService, EcgAnalysisService, LabResultDetectionOrchestrator, LabAlertGateway],
})
export class LabTestModule { }
