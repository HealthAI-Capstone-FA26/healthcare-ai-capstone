import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { INVOICE_PAID_EVENT, InvoicePaidEvent } from '../events/invoice-paid.event';
import { NotificationDispatcherService } from '../../notification/notification-dispatcher.service';

/**
 * Lắng nghe `invoice.paid` (§3.4 bước 4) và dispatch Notification 'payment_success' qua
 * email + in_app — chạy nền, tách khỏi request xác nhận thanh toán/webhook chính.
 */
@Injectable()
export class InvoicePaidListener {
  private readonly logger = new Logger(InvoicePaidListener.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationDispatcher: NotificationDispatcherService,
  ) {}

  @OnEvent(INVOICE_PAID_EVENT)
  async handleInvoicePaid(event: InvoicePaidEvent): Promise<void> {
    const patient = await this.prisma.patient.findUnique({
      where: { patientId: event.patientId },
      select: { email: true },
    });

    await this.notificationDispatcher.dispatch(
      {
        recipient: { patientId: event.patientId, email: patient?.email ?? undefined },
        notificationType: 'payment_success',
        referenceType: 'invoice',
        referenceId: event.invoiceId,
        title: 'Thanh toán thành công',
        content: `Hoá đơn ${event.invoiceId} đã được thanh toán thành công.`,
      },
      ['email', 'in_app'],
    );

    this.logger.log(`Đã dispatch thông báo payment_success cho hoá đơn ${event.invoiceId}`);
  }
}
