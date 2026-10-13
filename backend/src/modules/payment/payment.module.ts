import { Module } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserModule } from '../user/user.module';
import { LabTestModule } from '../lab-test/lab-test.module';

import { ExaminationFeeController } from './examination-fee/examination-fee.controller';
import { ExaminationFeeService } from './examination-fee/examination-fee.service';

import { InvoiceController } from './invoice/invoice.controller';
import { InvoiceService } from './invoice/invoice.service';
import {
  LAB_TASK_PAYMENT_NOTIFIER_PORT,
  LabTaskPaymentNotifierAdapter,
} from './invoice/ports/lab-task-payment-notifier.port';
import { InvoicePaidListener } from './invoice/listeners/invoice-paid.listener';

import { PaymentController } from './payment/payment.controller';
import { PaymentWebhookController } from './payment/payment-webhook.controller';
import { PaymentService } from './payment/payment.service';
import {
  INVOICE_PDF_GENERATOR_PORT,
  PdfInvoiceGeneratorAdapter,
} from './payment/ports/invoice-pdf-generator.port';
import { PAYMENT_GATEWAY_PORT, PayOsPaymentGatewayAdapter } from './payment/ports/payment-gateway.port';

import { EMAIL_SENDER_PORT, DefaultEmailSenderAdapter } from './notification/ports/email-sender.port';
import { EmailNotificationStrategy } from './notification/strategies/email-notification.strategy';
import { InAppNotificationStrategy } from './notification/strategies/in-app-notification.strategy';
import { NotificationDispatcherService } from './notification/notification-dispatcher.service';

/**
 * Module 6 — Thanh toán chi phí.
 *
 * Trạng thái hiện tại (Phase 0-7 theo lộ trình §8 — ĐỦ):
 *   - examination-fee: CRUD bảng giá khám, actor qua ActorRoleService (ADMIN) — §2.1.
 *   - invoice: sinh/xem/huỷ hoá đơn + PDF, RBAC qua PermissionsGuard + Resource.INVOICE — §2.2, §3.1, §3.5.
 *   - payment: 'cash' (P3) + 'bank_transfer' qua PayOS (P7) — RBAC qua PermissionsGuard +
 *     Resource.PAYMENT — §2.3, §3.2a, §3.2b. Webhook PayOS nằm ở PaymentWebhookController riêng
 *     (không guard — §3.3, §5).
 *   - markPaidIfSettled (§3.4) chạy đủ 4 bước: set 'paid' (P3) -> verify LabTask (P4) ->
 *     generate/upload PDF (P6) -> emit 'invoice.paid' cho InvoicePaidListener dispatch
 *     Notification 'payment_success' (P5). generate() cũng dispatch 'invoice_issued' (P5).
 *     Cash-confirm và webhook PayOS (P7) đều gọi chung method này, không viết lại logic.
 *
 * imports: [LabTestModule] (P4) — chỉ để LabTaskPaymentNotifierAdapter inject LabTaskService đã
 * export sẵn, KHÔNG sửa gì trong lab-test. PAYMENT_GATEWAY_PORT (P7) dùng ConfigService —
 * ConfigModule đã đăng ký global ở app.module.ts gốc (ConfigModule.forRoot({isGlobal:true})),
 * không cần import lại ở đây.
 */
@Module({
  imports: [UserModule, LabTestModule],
  controllers: [ExaminationFeeController, InvoiceController, PaymentController, PaymentWebhookController],
  providers: [
    PrismaService,
    ExaminationFeeService,
    InvoiceService,
    PaymentService,
    { provide: LAB_TASK_PAYMENT_NOTIFIER_PORT, useClass: LabTaskPaymentNotifierAdapter },
    { provide: INVOICE_PDF_GENERATOR_PORT, useClass: PdfInvoiceGeneratorAdapter },
    { provide: PAYMENT_GATEWAY_PORT, useClass: PayOsPaymentGatewayAdapter },
    { provide: EMAIL_SENDER_PORT, useClass: DefaultEmailSenderAdapter },
    EmailNotificationStrategy,
    InAppNotificationStrategy,
    NotificationDispatcherService,
    InvoicePaidListener,
  ],
  exports: [InvoiceService, ExaminationFeeService],
})
export class PaymentModule {}
