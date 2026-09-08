import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

import { LabRoomController } from './lab-room-catalog/lab-room.controller';

import { LabTaskController } from './lab-task-intake/lab-task.controller';
import { LabTaskService } from './lab-task-intake/lab-task.service';
import { PAYMENT_VERIFICATION_PORT } from './lab-task-intake/payment-verification.port';
import { DefaultPaymentVerificationAdapter } from './lab-task-intake/payment-verification.port';
import { LabTaskOrderCancellationListener } from './lab-task-intake/listeners/lab-task-order-cancellation.listener';

import { LabResultController } from './lab-result-entry/lab-result.controller';
import { LabResultService } from './lab-result-entry/lab-result.service';

import { LabResultAlertController } from './lab-anomaly/lab-result-alert.controller';
import { LabResultDetectionOrchestrator } from './lab-anomaly/orchestrators/lab-result-detection.orchestrator';
import { AiLabResultDetector } from './lab-anomaly/detectors/ai-lab-result.detector';
import { LabAlertGateway } from './lab-anomaly/lab-alert.gateway';
import { LabResultDetectionListener } from './lab-anomaly/listeners/lab-result-detection.listener';
import { LabPatientContextResolver } from './lab-anomaly/resolvers/lab-patient-context.resolver';

import { LabAiAnalysisController } from './lab-ai-analysis/lab-ai-analysis.controller';
import { AiLabAnalysisService } from './lab-ai-analysis/ai-lab-analysis.service';

import { LabReferenceRangeController } from './lab-reference-range/lab-reference-range.controller';
import { LabReferenceRangeService } from './lab-reference-range/lab-reference-range.service';

import { LabCompletionNotificationService } from './lab-completion/lab-completion-notification.service';

import { UserModule } from '../user/user.module';
import { LabRoomService } from './lab-room-catalog/lab-room.service';
import { RuleBasedLabDetector } from './lab-anomaly/detectors/rule-based.detector';
import { DefaultEmailSenderAdapter, EMAIL_SENDER_PORT } from './notification/ports/email-sender.port';
import { DefaultPushSenderAdapter, PUSH_SENDER_PORT } from './notification/ports/push-sender.port';
import { InAppNotificationStrategy } from './notification/strategies/in-app-notification.strategy';
import { EmailNotificationStrategy } from './notification/strategies/email-notification.strategy';
import { PushNotificationStrategy } from './notification/strategies/push-notification.strategy';
import { NotificationDispatcherService } from './notification/notification-dispatcher.service';

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
 *       - đẩy TỪNG ảnh đính kèm sang khung AI phân tích (lab-ai-analysis) để kết luận
 *         ảnh đó có bất thường (anomaly) hay không — CHỈ dựa trên bản thân ảnh, không đối
 *         chiếu chéo với bảng số liệu hay yếu tố nào khác, và KHÔNG khoanh vùng tổn thương —
 *         hiện là stub;
 *       - kiểm tra nếu đây là kết quả cuối cùng còn thiếu của lượt khám thì gửi Notification
 *         cho bác sĩ phụ trách và bệnh nhân qua email + in-app (ưu tiên cao) và push (ưu tiên
 *         thấp hơn, hiện là stub) — theo Strategy pattern (lab-completion/notification/).
 *
 * AUTH: mọi controller trong module này (trừ POST /lab-tasks/:id/verify-payment, được gọi bởi
 * module Thanh toán chứ không phải user đăng nhập) đã gắn JwtAuthGuard; các action ghi actor
 * (receive/report-exception/resolve-exception ở lab-task-intake, submit/update/add-attachment ở
 * lab-result-entry) lấy userId từ req.user (JWT) và assert actorRole tương ứng qua
 * ActorRoleService (LAB_STAFF cho các API của phòng Lab, DOCTOR cho resolve-exception) — cùng
 * cơ chế với LabRoomService.assignStaff, không dùng RequirePermissions/PermissionsGuard vì
 * PERMISSIONS_DICTIONARY hiện chưa có Resource cho domain lab-test.
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
        LabTaskOrderCancellationListener,
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
        { provide: EMAIL_SENDER_PORT, useClass: DefaultEmailSenderAdapter },
        { provide: PUSH_SENDER_PORT, useClass: DefaultPushSenderAdapter },
        InAppNotificationStrategy,
        EmailNotificationStrategy,
        PushNotificationStrategy,
        NotificationDispatcherService,
    ],
    exports: [
        LabTaskService,
        LabResultService,
        LabResultDetectionOrchestrator,
        LabAlertGateway,
    ],
})
export class LabTestModule { }
