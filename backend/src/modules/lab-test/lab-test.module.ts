import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

import { LabRoomController } from './lab-room-catalog/lab-room.controller';

import { LabTaskController } from './lab-task-intake/lab-task.controller';
import { LabTaskService } from './lab-task-intake/lab-task.service';
import { PAYMENT_VERIFICATION_PORT } from './lab-task-intake/payment-verification.port';
import { DefaultPaymentVerificationAdapter } from './lab-task-intake/payment-verification.port';

import { LabResultController } from './lab-result-entry/lab-result.controller';
import { LabResultService } from './lab-result-entry/lab-result.service';

import { LabResultAlertController } from './lab-anomaly/lab-result-alert.controller';
import { LabResultDetectionOrchestrator } from './lab-anomaly/lab-result-detection.orchestrator';
import { RuleBasedLabDetector } from './lab-anomaly/rule-based.detector';
import { AiLabResultDetector } from './lab-anomaly/ai-lab-result.detector';
import { LabAlertGateway } from './lab-anomaly/lab-alert.gateway';
import { LabResultDetectionListener } from './lab-anomaly/lab-result-detection.listener';
import { LabPatientContextResolver } from './lab-anomaly/lab-patient-context.resolver';

import { LabAiAnalysisController } from './lab-ai-analysis/lab-ai-analysis.controller';
import { AiLabAnalysisService } from './lab-ai-analysis/ai-lab-analysis.service';

import { LabReferenceRangeController } from './lab-reference-range/lab-reference-range.controller';
import { LabReferenceRangeService } from './lab-reference-range/lab-reference-range.service';

import { LabCompletionNotificationService } from './lab-completion/lab-completion-notification.service';

import { UserModule } from '../user/user.module';
import { LabRoomService } from './lab-room-catalog/lab-room.service';

/**
 * Mô-đun 7 — Xét nghiệm tại phòng Lab.
 *
 * Luồng chính:
 *  1. Bác sĩ chỉ định (module Order/Encounter — không thuộc phạm vi module này) tạo LabTask
 *     (status = 'payment_pending', paymentVerified = false).
 *  2. Module thanh toán gọi POST /lab-tasks/:id/verify-payment khi hoá đơn được thanh toán
 *     -> LabTaskService chuyển task sang 'ready'.
 *  3. Kỹ thuật viên phòng Lab (được phân quyền theo LabStaffRoomAssignment) tiếp nhận
 *     (POST /lab-tasks/:id/receive) rồi nhập kết quả (POST /lab-tasks/:id/results).
 *  4. Sau khi nhập kết quả, hệ thống tự động (event-driven, chạy nền — không block API):
 *       - chạy phát hiện bất thường theo ngưỡng (lab-anomaly) và tạo LabResultAlert;
 *       - đẩy dữ liệu sang khung AI phân tích (lab-ai-analysis) — hiện là stub;
 *       - kiểm tra nếu đây là kết quả cuối cùng còn thiếu của lượt khám thì gửi Notification
 *         cho bác sĩ phụ trách và bệnh nhân (lab-completion).
 *
 * TODO khi có auth module: gắn Guard theo role (DOCTOR để chỉ định — module khác, LAB_STAFF cho
 * các API dưới đây) và lấy userId từ req.user thay vì client tự truyền lên.
 */
@Module({
    imports: [UserModule],
    controllers: [
        LabRoomController,
        LabTaskController,
        LabResultController,
        LabResultAlertController,
        LabAiAnalysisController,
        LabReferenceRangeController,
    ],
    providers: [
        PrismaService,
        LabRoomService,
        LabTaskService,
        { provide: PAYMENT_VERIFICATION_PORT, useClass: DefaultPaymentVerificationAdapter },
        LabResultService,
        RuleBasedLabDetector,
        AiLabResultDetector,
        LabPatientContextResolver,
        LabResultDetectionOrchestrator,
        LabAlertGateway,
        LabResultDetectionListener,
        AiLabAnalysisService,
        LabReferenceRangeService,
        LabCompletionNotificationService,
    ],
    exports: [
        LabTaskService,
        LabResultService,
        LabResultDetectionOrchestrator,
        LabAlertGateway,
    ],
})
export class LabTestModule { }
