import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../prisma/prisma.service';
import { generateUniqueCode } from '../../../common/utils/code-generator.util';
import { ExaminationFeeService } from '../examination-fee/examination-fee.service';
import { GenerateInvoiceDto } from './dtos/generate-invoice.dto';
import { ListInvoicesQueryDto } from './dtos/list-invoices-query.dto';
import { CancelInvoiceDto } from './dtos/cancel-invoice.dto';
import {
  LAB_TASK_PAYMENT_NOTIFIER_PORT,
  LabTaskPaymentNotifierPort,
} from './ports/lab-task-payment-notifier.port';
import {
  INVOICE_PDF_GENERATOR_PORT,
  InvoicePdfGeneratorPort,
} from '../payment/ports/invoice-pdf-generator.port';
import { NotificationDispatcherService } from '../notification/notification-dispatcher.service';
import { INVOICE_PAID_EVENT, InvoicePaidEvent } from './events/invoice-paid.event';

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly examinationFeeService: ExaminationFeeService,
    @Inject(LAB_TASK_PAYMENT_NOTIFIER_PORT)
    private readonly labTaskPaymentNotifier: LabTaskPaymentNotifierPort,
    @Inject(INVOICE_PDF_GENERATOR_PORT)
    private readonly invoicePdfGenerator: InvoicePdfGeneratorPort,
    private readonly notificationDispatcher: NotificationDispatcherService,
    private readonly eventEmitter: EventEmitter2,
  ) { }

  /**
   * POST /invoices/generate — §3.1.
   * Invoice phí khám có thể được lập từ Appointment trước khi tạo Encounter. Invoice xét nghiệm
   * vẫn phải gắn với Encounter. Mỗi InvoiceItem là phí khám (examinationFeeId) HOẶC dòng chỉ định CLS
   * (orderItemId — unique nên mỗi dòng chỉ được tính tiền 1 lần).
   */
  async generate(dto: GenerateInvoiceDto) {
    if (!dto.encounterId && !dto.appointmentId) {
      throw new BadRequestException('Cần cung cấp encounterId hoặc appointmentId');
    }
    if (dto.encounterId && dto.appointmentId) {
      throw new BadRequestException('Chỉ được cung cấp một trong encounterId hoặc appointmentId');
    }

    const encounter = dto.encounterId
      ? await this.prisma.encounter.findUnique({
          where: { encounterId: dto.encounterId },
          include: { appointment: true },
        })
      : null;
    const appointment = dto.appointmentId
      ? await this.prisma.appointment.findUnique({
          where: { appointmentId: dto.appointmentId },
          include: { encounter: true },
        })
      : null;
    if (!encounter && !appointment) {
      throw new NotFoundException(
        dto.encounterId
          ? `Không tìm thấy lượt khám ${dto.encounterId}`
          : `Không tìm thấy lịch hẹn ${dto.appointmentId}`,
      );
    }
    if (!encounter && !appointment) {
      throw new BadRequestException('Không có ngữ cảnh để lập hoá đơn');
    }
    const targetEncounter = encounter ?? (dto.appointmentId ? appointment?.encounter ?? null : null);
    const targetAppointment = appointment ?? encounter?.appointment;
    const patientId = targetAppointment?.patientId;
    if (!targetAppointment || !patientId) {
      throw new BadRequestException('Lịch hẹn chưa có hồ sơ bệnh nhân');
    }
    if (targetEncounter && dto.appointmentId && targetEncounter.appointmentId !== dto.appointmentId) {
      throw new BadRequestException('Lịch hẹn không khớp với lượt khám');
    }

    type NewItem = {
      examinationFeeId?: string;
      orderItemId?: string;
      description: string;
      quantity: number;
      unitPrice: number;
      amount: number;
    };
    const newItems: NewItem[] = [];

    // 1. Phí khám: chỉ lập 1 lần cho mỗi lượt khám (hoá đơn chưa huỷ).
    const hasConsultationItem = await this.prisma.invoiceItem.findFirst({
      where: {
        examinationFeeId: { not: null },
        invoice: targetEncounter
          ? { encounterId: targetEncounter.encounterId, status: { not: 'cancelled' } }
          : { appointmentId: targetAppointment.appointmentId, status: { not: 'cancelled' } },
      },
      select: { invoiceItemId: true },
    });

    if (!hasConsultationItem) {
      const feeType = targetAppointment.appointmentType === 'follow_up' ? 'follow_up' : 'standard';
      const fee =
        (await this.examinationFeeService.findActiveFee(feeType)) ??
        (feeType !== 'standard' ? await this.examinationFeeService.findActiveFee('standard') : null);
      if (fee) {
        const price = Number(fee.price);
        newItems.push({
          examinationFeeId: fee.feeId,
          description: `Phí khám: ${fee.feeName}`,
          quantity: 1,
          unitPrice: price,
          amount: price,
        });
      }
    }

    // 2. Dòng chỉ định CLS chưa bị huỷ và chưa có InvoiceItem nào (kể cả hoá đơn khác của encounter).
    const orderItems = await this.prisma.diagnosticOrderItem.findMany({
      where: {
        order: { encounterId: targetEncounter?.encounterId ?? '__no_encounter__' },
        status: { not: 'cancelled' },
        invoiceItem: { is: null },
      },
      include: { service: true },
    });
    for (const item of orderItems) {
      const price = Number(item.unitPrice);
      newItems.push({
        orderItemId: item.orderItemId,
        description: `Dịch vụ CLS: ${item.service.serviceName}`,
        quantity: 1,
        unitPrice: price,
        amount: price,
      });
    }

    // 3. Không có item mới -> 400.
    if (newItems.length === 0) {
      throw new BadRequestException(
        'Không có mục chi phí nào mới để lập hoá đơn (phí khám đã lập, dịch vụ CLS đã lập hết hoặc chưa có).',
      );
    }

    // 4. Tính tổng.
    const subtotalAmount = newItems.reduce((sum, item) => sum + item.amount, 0);
    const discountAmount = dto.discountAmount ?? 0;
    const totalAmount = Math.max(subtotalAmount - discountAmount, 0);

    // consultation | diagnostics | other (hỗn hợp)
    const invoiceType = newItems.every((i) => i.examinationFeeId)
      ? 'consultation'
      : newItems.every((i) => i.orderItemId)
        ? 'diagnostics'
        : 'other';

    // 5. Sinh invoiceCode.
    const invoiceCode = await generateUniqueCode('HD', (code) =>
      this.prisma.invoice.findUnique({ where: { invoiceCode: code } }).then(Boolean),
    );

    // 6. Tạo Invoice + InvoiceItem[] trong 1 transaction.
    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          invoiceCode,
          encounterId: targetEncounter?.encounterId,
          appointmentId: targetAppointment.appointmentId,
          patientId,
          invoiceType,
          subtotalAmount,
          discountAmount,
          totalAmount,
          currency: 'VND',
          status: 'pending',
          issuedAt: new Date(),
        },
      });

      await tx.invoiceItem.createMany({
        data: newItems.map((item) => ({
          invoiceId: created.invoiceId,
          examinationFeeId: item.examinationFeeId ?? null,
          orderItemId: item.orderItemId ?? null,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          amount: item.amount,
        })),
      });

      return created;
    });

    // 7. Dispatch Notification 'invoice_issued' qua email + in_app (Phase 5) — không chặn nếu lỗi
    // (NotificationDispatcherService tự log lỗi từng kênh, không throw ra ngoài).
    await this.dispatchInvoiceIssuedNotification(invoice.invoiceId, patientId);

    return this.findById(invoice.invoiceId);
  }

  /** §3.1 bước 8. */
  private async dispatchInvoiceIssuedNotification(invoiceId: string, patientId: string): Promise<void> {
    const patient = await this.prisma.patient.findUnique({
      where: { patientId },
      select: { email: true },
    });

    await this.notificationDispatcher.dispatch(
      {
        recipient: { patientId, email: patient?.email ?? undefined },
        notificationType: 'invoice_issued',
        referenceType: 'invoice',
        referenceId: invoiceId,
        title: 'Hoá đơn mới đã được lập',
        content: `Hoá đơn ${invoiceId} đã được lập, vui lòng thanh toán.`,
      },
      ['email', 'in_app'],
    );
  }

  async findById(invoiceId: string) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { invoiceId },
      include: { items: true, payments: true },
    });
    if (!invoice) {
      throw new NotFoundException(`Không tìm thấy hoá đơn ${invoiceId}`);
    }
    return invoice;
  }

  async findMany(query: ListInvoicesQueryDto) {
    return this.prisma.invoice.findMany({
      where: {
        ...(query.appointmentId ? { encounter: { appointmentId: query.appointmentId } } : {}),
        ...(query.patientId ? { patientId: query.patientId } : {}),
        ...(query.encounterId ? { encounterId: query.encounterId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: { items: true, payments: true },
    });
  }

  async cancel(invoiceId: string, dto: CancelInvoiceDto) {
    const invoice = await this.findById(invoiceId);

    if (invoice.status !== 'pending') {
      throw new BadRequestException(
        `Chỉ có thể huỷ hoá đơn đang ở trạng thái 'pending', hoá đơn này đang '${invoice.status}'.`,
      );
    }

    const hasSuccessPayment = invoice.payments.some((p) => p.status === 'success');
    if (hasSuccessPayment) {
      throw new BadRequestException('Không thể huỷ hoá đơn đã có giao dịch thanh toán thành công.');
    }

    // InvoiceItem.orderItemId là UNIQUE: giải phóng các dòng CLS của hoá đơn bị huỷ để có thể lập lại hoá đơn.
    return this.prisma.$transaction(async (tx) => {
      await tx.invoiceItem.deleteMany({ where: { invoiceId, orderItemId: { not: null } } });
      return tx.invoice.update({
        where: { invoiceId },
        data: { status: 'cancelled' },
      });
    });
    // dto.cancelReason: chưa có cột lưu lý do huỷ trong schema hiện tại -> chỉ nhận, chưa lưu (TODO).
  }

  /**
   * §3.4 Side-effects khi 1 Payment -> success (dùng chung cho cash-confirm và webhook PayOS).
   * Phase 3 làm bước 1. Phase 4/5/6 nối thêm bước 2/3/4 lần lượt bên dưới — không sửa lại bước 1.
   */
  async markPaidIfSettled(invoiceId: string) {
    const invoice = await this.findById(invoiceId);

    const totalPaid = invoice.payments
      .filter((p) => p.status === 'success')
      .reduce((sum, p) => sum + Number(p.amount), 0);

    if (invoice.status !== 'pending' || totalPaid < Number(invoice.totalAmount)) {
      return invoice;
    }

    // 1. Đã thu đủ tiền -> chuyển Invoice sang 'paid' atomically.
    const paidResult = await this.prisma.invoice.updateMany({
      where: { invoiceId, status: 'pending' },
      data: { status: 'paid' },
    });
    if (paidResult.count === 0) {
      return invoice;
    }

    // 2. Với từng InvoiceItem là dòng chỉ định CLS (orderItemId != null) của invoice vừa paid -> báo DiagnosticTask tương ứng.
    // Chạy song song, KHÔNG throw ra ngoài nếu 1 item lỗi (adapter đã tự log warn khi thiếu LabTask)
    // để 1 item lỗi không chặn các item còn lại hay chặn việc hoá đơn đã được đánh dấu 'paid'.
    const testItems = invoice.items.filter((item) => item.orderItemId);
    await Promise.all(
      testItems.map((item) =>
        this.labTaskPaymentNotifier.verifyPaymentByOrderItemId(item.orderItemId as string).catch((err) => {
          this.logger.error(
            `Lỗi verify-payment DiagnosticTask cho orderItemId=${item.orderItemId} (invoiceId=${invoiceId}): ${(err as Error)?.message}`,
          );
        }),
      ),
    );

    // 3. Generate + upload PDF nếu chưa có pdfFileUrl (§3.5).
    await this.ensurePdfGenerated(invoiceId).catch((err) => {
      this.logger.error(`Lỗi sinh PDF cho hoá đơn ${invoiceId}: ${(err as Error)?.message}`);
    });

    // 4. Emit event 'invoice.paid' -> listener riêng dispatch Notification 'payment_success',
    // tách khỏi luồng chính để không block API xác nhận thanh toán/webhook.
    this.eventEmitter.emit(INVOICE_PAID_EVENT, new InvoicePaidEvent(invoiceId, invoice.patientId));

    return this.findById(invoiceId);
  }

  /**
   * §3.5 — sinh PDF hoá đơn + upload MinIO nếu Invoice.pdfFileUrl chưa có, rồi lưu URL lại.
   * Idempotent: gọi lại khi đã có pdfFileUrl thì bỏ qua, không sinh lại.
   */
  private async ensurePdfGenerated(invoiceId: string) {
    const invoice = await this.findById(invoiceId);
    if (invoice.pdfFileUrl) {
      return invoice;
    }

    const { url } = await this.invoicePdfGenerator.generateAndUpload({
      invoiceId: invoice.invoiceId,
      invoiceCode: invoice.invoiceCode,
      items: invoice.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: Number(item.unitPrice),
        amount: Number(item.amount),
      })),
      subtotalAmount: Number(invoice.subtotalAmount),
      discountAmount: Number(invoice.discountAmount ?? 0),
      totalAmount: Number(invoice.totalAmount),
      currency: invoice.currency,
      issuedAt: invoice.issuedAt,
    });

    return this.prisma.invoice.update({
      where: { invoiceId },
      data: { pdfFileUrl: url },
    });
  }

  /**
   * GET /invoices/:id/pdf — §3.5. Đã có pdfFileUrl -> trả luôn; chưa có (VD: hoá đơn chưa 'paid',
   * hoặc muốn xem trước) -> generate on-demand rồi trả.
   */
  async getOrGeneratePdfUrl(invoiceId: string): Promise<{ url: string }> {
    const invoice = await this.ensurePdfGenerated(invoiceId);
    return { url: invoice.pdfFileUrl! };
  }
}
