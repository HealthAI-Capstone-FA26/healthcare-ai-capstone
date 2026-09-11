import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { LabTaskService } from '../../../lab-test/lab-task-intake/lab-task.service';

/**
 * Cổng (port) báo "order item xét nghiệm đã thanh toán" sang module Lab-test — tách interface
 * riêng để module Invoice không phụ thuộc cứng vào chi tiết nội bộ lab-test (cùng kiểu thiết kế
 * đã dùng ở PAYMENT_VERIFICATION_PORT phía lab-test). §4.
 */
export const LAB_TASK_PAYMENT_NOTIFIER_PORT = 'LAB_TASK_PAYMENT_NOTIFIER_PORT';

export interface LabTaskPaymentNotifierPort {
  /** Báo cho lab-test rằng order item xét nghiệm này đã thanh toán xong. */
  verifyPaymentByOrderItemId(orderItemId: string): Promise<void>;
}

/**
 * Adapter thật — inject LabTaskService (đã export sẵn qua LabTestModule.exports,
 * PaymentModule.imports:[LabTestModule]). Tự tra LabTask theo orderItemId (unique) rồi gọi
 * method public LabTaskService.verifyPayment(labTaskId) đã có sẵn — KHÔNG sửa lab-task.service.ts.
 */
@Injectable()
export class LabTaskPaymentNotifierAdapter implements LabTaskPaymentNotifierPort {
  private readonly logger = new Logger(LabTaskPaymentNotifierAdapter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly labTaskService: LabTaskService,
  ) {}

  async verifyPaymentByOrderItemId(orderItemId: string): Promise<void> {
    const task = await this.prisma.labTask.findUnique({
      where: { orderItemId },
      select: { labTaskId: true },
    });

    if (!task) {
      // InvoiceItem itemType='tests' nhưng không có LabTask tương ứng (dữ liệu thiếu/không đồng bộ)
      // -> chỉ log cảnh báo, không throw, để không chặn việc verify các InvoiceItem 'tests' còn lại
      // hay làm fail luồng thanh toán chính.
      this.logger.warn(
        `Không tìm thấy LabTask ứng với orderItemId=${orderItemId} — bỏ qua verify-payment.`,
      );
      return;
    }

    await this.labTaskService.verifyPayment(task.labTaskId);
  }
}
