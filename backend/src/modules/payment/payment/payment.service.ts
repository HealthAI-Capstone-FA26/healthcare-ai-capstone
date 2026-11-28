import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RequestUser } from '../../identity-access/auth/strategies/jwt.strategy';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { hasPermissionScope } from '../../../common/utils/permission.util';
import { InvoiceService } from '../invoice/invoice.service';
import { ActorRoleService } from '../../identity-access/user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { CreateCashPaymentDto } from './dtos/create-cash-payment.dto';
import { ConfirmCashPaymentDto } from './dtos/confirm-cash-payment.dto';
import { CreateBankTransferPaymentDto } from './dtos/create-bank-transfer-payment.dto';
import { PayOsWebhookDto } from './dtos/payos-webhook.dto';
import { PAYMENT_GATEWAY_PORT, PaymentGatewayPort } from './ports/payment-gateway.port';

/**
 * Phase 3: 'cash'. Phase 7 nối thêm 'bank_transfer' (PayOS) ở cuối file — §3.2b, §3.3, §4.
 * Không sửa lại các method 'cash' đã có ở Phase 3.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceService: InvoiceService,
    private readonly actorRoleService: ActorRoleService,
    private readonly configService: ConfigService,
    @Inject(PAYMENT_GATEWAY_PORT)
    private readonly paymentGateway: PaymentGatewayPort,
  ) {}

  /** POST /payments/cash — §3.2a. */
  async createCashPayment(dto: CreateCashPaymentDto) {
    const invoice = await this.invoiceService.findById(dto.invoiceId);

    if (invoice.status !== 'pending') {
      throw new BadRequestException(
        `Chỉ có thể thanh toán hoá đơn đang ở trạng thái 'pending', hoá đơn này đang '${invoice.status}'.`,
      );
    }

    const totalPaid = invoice.payments
      .filter((p) => p.status === 'success')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const remaining = Number(invoice.totalAmount) - totalPaid;

    if (dto.amount !== remaining) {
      throw new BadRequestException(
        `Số tiền không khớp: hoá đơn còn phải thu ${remaining}, nhận được ${dto.amount}.`,
      );
    }

    return this.prisma.payment.create({
      data: {
        invoiceId: dto.invoiceId,
        paymentMethod: 'cash',
        amount: dto.amount,
        status: 'pending',
      },
    });
  }

  /**
   * POST /payments/cash/:id/confirm — §3.2a.
   * actor lấy từ @CurrentUser() (RECEPTIONIST) ở controller, truyền receivedByUserId vào đây.
   * Phase 3: bỏ qua §3.4 bước 2-4 (LabTask/PDF/notification) — markPaidIfSettled hiện chỉ set
   * Invoice.status='paid'. Các phase sau nối thêm vào chính markPaidIfSettled, không sửa ở đây.
   */
  async confirmCashPayment(paymentId: string, _dto: ConfirmCashPaymentDto, receivedByUserId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { paymentId } });
    if (!payment) {
      throw new NotFoundException(`Không tìm thấy giao dịch thanh toán ${paymentId}`);
    }
    if (payment.paymentMethod !== 'cash') {
      throw new ForbiddenException('Chỉ xác nhận được giao dịch thanh toán tiền mặt qua endpoint này.');
    }
    if (payment.status !== 'pending') {
      throw new BadRequestException(
        `Giao dịch đang ở trạng thái '${payment.status}', chỉ có thể xác nhận khi đang 'pending'.`,
      );
    }

    await this.prisma.payment.update({
      where: { paymentId },
      data: { status: 'success', paidAt: new Date(), receivedByUserId },
    });

    await this.invoiceService.markPaidIfSettled(payment.invoiceId);

    return this.getById(paymentId);
  }

  /**
   * POST /payments/bank-transfer — §3.2b. Actor RECEPTIONIST hoặc PATIENT (§2.3).
   * Route gắn permission scope OWN ở controller (Scope.OWN có rank thấp nhất — xem
   * permission.util.ts SCOPE_RANK) nên user có scope ALL (RECEPTIONIST) hay OWN (PATIENT) đều
   * qua được PermissionsGuard; ở đây chỉ cần validate thêm cho case scope OWN: PATIENT chỉ được
   * thanh toán đúng hoá đơn của chính mình (tra qua Patient.userId), giống pattern đã dùng ở
   * PatientService.getFullProfile(). Cần gán thêm permission 'payment:create:own' cho role
   * PATIENT qua RolePermissionController (giống cách §5 đã gán 'payment:create:all' cho
   * RECEPTIONIST/ADMIN) — không cần Resource mới.
   *
   * KHÔNG nhận `amount` từ FE — server tự tính số tiền còn thiếu, tránh lệch với PayOS.
   */
  async createBankTransferPayment(dto: CreateBankTransferPaymentDto, currentUser: RequestUser) {
    const invoice = await this.invoiceService.findById(dto.invoiceId);

    const hasFullScope = hasPermissionScope(currentUser.permissions, Resource.PAYMENT, Action.CREATE, Scope.ALL);
    const actorRole = await this.actorRoleService.getActorRole(currentUser.userId);
    const canPayForAnyPatient =
      hasFullScope || actorRole === ACTOR_ROLE.RECEPTIONIST || actorRole === ACTOR_ROLE.ADMIN;

    if (!canPayForAnyPatient) {
      // Chỉ có scope 'own' (PATIENT) -> phải là chủ hoá đơn.
      const ownPatient = await this.prisma.patient.findUnique({ where: { userId: currentUser.userId } });
      if (!ownPatient || ownPatient.patientId !== invoice.patientId) {
        throw new ForbiddenException('Chỉ được thanh toán hoá đơn của chính mình.');
      }
    }

    if (invoice.status !== 'pending') {
      throw new BadRequestException(
        `Chỉ có thể thanh toán hoá đơn đang ở trạng thái 'pending', hoá đơn này đang '${invoice.status}'.`,
      );
    }

    const totalPaid = invoice.payments
      .filter((p) => p.status === 'success')
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const remaining = Number(invoice.totalAmount) - totalPaid;

    if (remaining <= 0) {
      throw new BadRequestException('Hoá đơn đã được thanh toán đủ.');
    }

    const payment = await this.prisma.payment.create({
      data: {
        invoiceId: dto.invoiceId,
        paymentMethod: 'bank_transfer',
        amount: remaining,
        status: 'pending',
      },
    });

    // §3.2b bước 3 — PayOS yêu cầu orderCode là số nguyên dương (<= Number.MAX_SAFE_INTEGER).
    // Sinh mã 15 chữ số (timestamp millis + 2 số ngẫu nhiên) và kiểm tra không trùng trong DB.
    const orderCode = await this.generateUniqueOrderCode();
    // PayOS giới hạn description ngắn (~25 ký tự) -> cắt gọn, chỉ giữ mã hoá đơn.
    const description = `Thanh toan HD ${invoice.invoiceCode}`.slice(0, 25);
    const cancelUrl = this.configService.get<string>('PAYOS_CANCEL_URL') ?? '';
    const returnUrl = this.configService.get<string>('PAYOS_RETURN_URL') ?? '';

    let checkoutUrl: string;
    let paymentLinkId: string;
    let qrCode: string | undefined;
    let accountNumber: string | undefined;
    let accountName: string | undefined;
    let bin: string | undefined;
    let transferDescription: string = description;
    try {
      const link = await this.paymentGateway.createPaymentLink({
        orderCode,
        amount: remaining,
        description,
        cancelUrl,
        returnUrl,
      });
      checkoutUrl = link.checkoutUrl;
      paymentLinkId = link.paymentLinkId;
      qrCode = link.qrCode;
      accountNumber = link.accountNumber;
      accountName = link.accountName;
      bin = link.bin;
      if (link.description) {
        transferDescription = link.description;
      }
    } catch (err) {
      // Tạo link PayOS thất bại -> đánh dấu luôn Payment 'pending' vừa tạo thành 'failed' để
      // không để lại rác, cho phép người dùng bấm thử lại (tạo Payment mới).
      await this.prisma.payment.update({ where: { paymentId: payment.paymentId }, data: { status: 'failed' } });
      throw err;
    }

    // §3.2b bước 6. initiatedAt bắt buộc theo schema (PaymentGatewayTransaction.initiatedAt: DateTime, không có default).
    await this.prisma.paymentGatewayTransaction.create({
      data: {
        paymentId: payment.paymentId,
        provider: 'payos',
        providerTransactionRef: paymentLinkId,
        qrCodeData: qrCode ? qrCode.slice(0, 255) : checkoutUrl.slice(0, 255),
        requestPayload: { orderCode, amount: remaining, description: transferDescription, cancelUrl, returnUrl },
        responsePayload: {
          bin,
          accountNumber,
          accountName,
          qrCode,
          description: transferDescription,
        },
        status: 'initiated',
        initiatedAt: new Date(),
      },
    });

    return {
      paymentId: payment.paymentId,
      checkoutUrl,
      qrCode,
      accountNumber,
      accountName,
      bin,
      description: transferDescription,
    };
  }

  /**
   * POST /payments/bank-transfer/webhook — §3.3. KHÔNG guard (route nằm ở PaymentWebhookController
   * riêng, xem payment-webhook.controller.ts) — bảo vệ bằng xác thực signature ở đây.
   * Dùng chung §3.4 markPaidIfSettled với cash-confirm, không viết lại logic side-effects.
   *
   * Xử lý an toàn trước webhook trùng (duplicate), đến trễ (delayed), đảo thứ tự (out-of-order),
   * và lệch số tiền (amount mismatch):
   * - Ưu tiên tra cứu theo khóa unique (provider, paymentLinkId); fallback orderCode có check trùng.
   * - Không bao giờ hạ trạng thái Payment từ 'success'/'refunded' xuống 'failed'.
   * - Đối chiếu số tiền webhook với Payment.amount trước khi xác nhận thanh toán.
   * - Không tự mở khóa hoá đơn đã bị 'cancelled'/'refunded' khi callback thành công đến trễ.
   * - Cập nhật PaymentGatewayTransaction + Payment trong cùng 1 transaction theo khóa chính.
   */
  async handlePayOsWebhook(dto: PayOsWebhookDto) {
    // 2. Xác thực signature -> sai thì 400, KHÔNG xử lý tiếp.
    const isValidSignature = this.paymentGateway.verifyWebhookSignature(dto.data, dto.signature);
    if (!isValidSignature) {
      throw new BadRequestException('Chữ ký PayOS không hợp lệ.');
    }

    const orderCode = dto.data?.orderCode;
    const paymentLinkId =
      typeof dto.data?.paymentLinkId === 'string' && dto.data.paymentLinkId.trim() !== ''
        ? dto.data.paymentLinkId.trim()
        : undefined;

    // 3. Tìm PaymentGatewayTransaction: ưu tiên khóa unique (provider, providerTransactionRef).
    const transaction = await this.findPayOsTransactionForWebhook(paymentLinkId, orderCode);
    if (!transaction) {
      return { received: true };
    }

    const payment =
      transaction.payment ??
      (await this.prisma.payment.findUnique({
        where: { paymentId: transaction.paymentId },
        include: { invoice: true },
      }));

    if (!payment) {
      this.logger.warn(
        `Webhook PayOS: không tìm thấy Payment ${transaction.paymentId} cho orderCode=${orderCode}.`,
      );
      return { received: true };
    }

    // Idempotency guard: giao dịch đã ở trạng thái kết thúc thành công/hoàn tiền -> không ghi đè ngược.
    if (payment.status === 'success' || payment.status === 'refunded') {
      this.logger.log(
        `Webhook PayOS: bỏ qua callback lặp/đến trễ cho Payment ${payment.paymentId} (đang '${payment.status}', orderCode=${orderCode}).`,
      );
      if (payment.status === 'success' && payment.invoice?.status === 'pending') {
        await this.invoiceService.markPaidIfSettled(payment.invoiceId);
      }
      return { received: true };
    }

    const isSuccess = dto.success === true && dto.code === '00';

    if (isSuccess) {
      // Kiểm tra khớp số tiền giữa webhook PayOS và Payment.amount
      const webhookAmount = dto.data?.amount;
      if (webhookAmount !== undefined && Number(webhookAmount) !== Number(payment.amount)) {
        this.logger.error(
          `Webhook PayOS LỆCH SỐ TIỀN cho Payment ${payment.paymentId} (orderCode=${orderCode}): ` +
            `kỳ vọng ${Number(payment.amount)}, nhận được ${Number(webhookAmount)}. Giữ nguyên trạng thái để đối soát.`,
        );
        await this.prisma.paymentGatewayTransaction.update({
          where: { gatewayTransactionId: transaction.gatewayTransactionId },
          data: {
            responsePayload: {
              ...(dto.data ?? {}),
              _mismatchReason: 'amount_mismatch',
              _expectedAmount: Number(payment.amount),
            },
          },
        });
        return { received: true };
      }

      // Chặn callback thành công đến trễ làm lệch hoá đơn đã huỷ/hoàn tiền
      if (payment.invoice && (payment.invoice.status === 'cancelled' || payment.invoice.status === 'refunded')) {
        this.logger.error(
          `Webhook PayOS thành công đến trễ cho hoá đơn ${payment.invoiceId} đang '${payment.invoice.status}' ` +
            `(Payment ${payment.paymentId}, orderCode=${orderCode}) — cần đối soát/hoàn tiền thủ công.`,
        );
        await this.prisma.paymentGatewayTransaction.update({
          where: { gatewayTransactionId: transaction.gatewayTransactionId },
          data: {
            responsePayload: {
              ...(dto.data ?? {}),
              _lateCallbackForInvoiceStatus: payment.invoice.status,
            },
            completedAt: new Date(),
            status: 'success',
          },
        });
        return { received: true };
      }

      // 5. Cập nhật atomic PaymentGatewayTransaction + Payment trong 1 transaction -> §3.4 markPaidIfSettled.
      await this.settleBankTransferPayment({
        paymentId: payment.paymentId,
        gatewayTransactionId: transaction.gatewayTransactionId,
        invoiceId: payment.invoiceId,
        expectedAmount: Number(payment.amount),
        gatewayPayload: dto.data,
        paidAmount: webhookAmount !== undefined ? Number(webhookAmount) : undefined,
      });
    } else {
      // 6. Callback thất bại: chỉ chuyển 'failed' nếu Payment vẫn đang 'pending' và gateway chưa 'success'.
      await this.prisma.$transaction(async (tx) => {
        await tx.paymentGatewayTransaction.updateMany({
          where: {
            gatewayTransactionId: transaction.gatewayTransactionId,
            status: { not: 'success' },
          },
          data: {
            responsePayload: dto.data,
            completedAt: new Date(),
            status: 'failed',
          },
        });
        await tx.payment.updateMany({
          where: { paymentId: transaction.paymentId, status: 'pending' },
          data: { status: 'failed' },
        });
      });
    }

    // 7. Luôn trả 200 cho payload đã xác thực chữ ký hợp lệ.
    return { received: true };
  }

  /** GET /payments/:id — đã login. */
  async getById(paymentId: string) {
    let payment = await this.prisma.payment.findUnique({
      where: { paymentId },
      include: { gatewayTransaction: true, invoice: true },
    });
    if (!payment) {
      throw new NotFoundException(`Không tìm thấy giao dịch thanh toán ${paymentId}`);
    }

    // Nếu là bank_transfer và đang pending -> chủ động kiểm tra trạng thái từ PayOS
    if (payment.paymentMethod === 'bank_transfer' && payment.status === 'pending') {
      const orderCode = (payment.gatewayTransaction?.requestPayload as any)?.orderCode;
      if (orderCode && payment.gatewayTransaction) {
        const payosInfo = await this.paymentGateway.getPaymentLinkInformation(orderCode);
        if (payosInfo?.status === 'PAID') {
          const paidAmount = payosInfo.amountPaid ?? payosInfo.amount;
          const settled = await this.settleBankTransferPayment({
            paymentId: payment.paymentId,
            gatewayTransactionId: payment.gatewayTransaction.gatewayTransactionId,
            invoiceId: payment.invoiceId,
            expectedAmount: Number(payment.amount),
            gatewayPayload: payosInfo,
            paidAmount: paidAmount !== undefined ? Number(paidAmount) : undefined,
            invoiceStatus: payment.invoice?.status,
          });
          if (settled) {
            const refreshed = await this.prisma.payment.findUnique({
              where: { paymentId: payment.paymentId },
              include: { gatewayTransaction: true },
            });
            return refreshed ?? payment;
          }
        }
      }

      // Kiểm tra thêm trường hợp đặc biệt: người dùng quét mã trước đó của hoá đơn này và đã thanh toán
      const invoice = await this.prisma.invoice.findUnique({
        where: { invoiceId: payment.invoiceId },
        include: { payments: { include: { gatewayTransaction: true } } },
      });

      if (invoice) {
        for (const siblingPayment of invoice.payments) {
          if (siblingPayment.paymentId === payment.paymentId) continue;
          if (siblingPayment.status === 'success') {
            await this.invoiceService.markPaidIfSettled(invoice.invoiceId);
            return siblingPayment;
          }
          if (
            siblingPayment.paymentMethod === 'bank_transfer' &&
            siblingPayment.status === 'pending' &&
            siblingPayment.gatewayTransaction
          ) {
            const siblingOrderCode = (siblingPayment.gatewayTransaction.requestPayload as any)?.orderCode;
            if (siblingOrderCode) {
              const siblingPayos = await this.paymentGateway.getPaymentLinkInformation(siblingOrderCode);
              if (siblingPayos?.status === 'PAID') {
                const paidAmount = siblingPayos.amountPaid ?? siblingPayos.amount;
                const settled = await this.settleBankTransferPayment({
                  paymentId: siblingPayment.paymentId,
                  gatewayTransactionId: siblingPayment.gatewayTransaction.gatewayTransactionId,
                  invoiceId: invoice.invoiceId,
                  expectedAmount: Number(siblingPayment.amount),
                  gatewayPayload: siblingPayos,
                  paidAmount: paidAmount !== undefined ? Number(paidAmount) : undefined,
                  invoiceStatus: invoice.status,
                });
                if (settled) {
                  const updatedSibling = await this.prisma.payment.findUnique({
                    where: { paymentId: siblingPayment.paymentId },
                    include: { gatewayTransaction: true },
                  });
                  return updatedSibling ?? siblingPayment;
                }
              }
            }
          }
        }
      }
    }

    return payment;
  }

  /**
   * Đối soát định kỳ (chạy từ PaymentReconciliationCron):
   * 1. Quét các Payment bank_transfer còn 'pending' trong 24h qua -> hỏi trực tiếp PayOS để đồng bộ
   *    khi webhook bị mất/trễ, hoặc đánh dấu 'failed'/'expired' khi link đã huỷ/hết hạn.
   * 2. Quét các Invoice bị kẹt 'pending' dù đã có Payment 'success' (do crash giữa chừng) -> gọi lại
   *    markPaidIfSettled để chuyển 'paid' và mở khóa DiagnosticTask.
   */
  async reconcilePendingPayments() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const pendingPayments = await this.prisma.payment.findMany({
      where: {
        paymentMethod: 'bank_transfer',
        status: 'pending',
        createdAt: { gte: since },
      },
      include: { gatewayTransaction: true, invoice: true },
      take: 100,
    });

    let settledCount = 0;
    let failedCount = 0;
    let stalePendingCount = 0;
    const staleThresholdMs = 15 * 60 * 1000;

    for (const payment of pendingPayments) {
      const txRecord = payment.gatewayTransaction;
      const orderCode = (txRecord?.requestPayload as any)?.orderCode;
      if (!txRecord || !orderCode) continue;

      const payosInfo = await this.paymentGateway.getPaymentLinkInformation(orderCode);
      if (payosInfo?.status === 'PAID') {
        const paidAmount = payosInfo.amountPaid ?? payosInfo.amount;
        const settled = await this.settleBankTransferPayment({
          paymentId: payment.paymentId,
          gatewayTransactionId: txRecord.gatewayTransactionId,
          invoiceId: payment.invoiceId,
          expectedAmount: Number(payment.amount),
          gatewayPayload: payosInfo,
          paidAmount: paidAmount !== undefined ? Number(paidAmount) : undefined,
          invoiceStatus: payment.invoice?.status,
        });
        if (settled) settledCount += 1;
      } else if (payosInfo?.status === 'CANCELLED' || payosInfo?.status === 'EXPIRED') {
        await this.prisma.$transaction(async (tx) => {
          await tx.paymentGatewayTransaction.updateMany({
            where: { gatewayTransactionId: txRecord.gatewayTransactionId, status: { not: 'success' } },
            data: {
              responsePayload: payosInfo,
              completedAt: new Date(),
              status: payosInfo.status === 'EXPIRED' ? 'expired' : 'failed',
            },
          });
          await tx.payment.updateMany({
            where: { paymentId: payment.paymentId, status: 'pending' },
            data: { status: 'failed' },
          });
        });
        failedCount += 1;
      } else if (payment.createdAt && Date.now() - new Date(payment.createdAt).getTime() >= staleThresholdMs) {
        stalePendingCount += 1;
        this.logger.warn(
          `[EARLY WARNING] Giao dịch PayOS pending quá 15 phút (paymentId=${payment.paymentId}, ` +
            `invoiceId=${payment.invoiceId}, orderCode=${orderCode}, payosStatus=${payosInfo?.status ?? 'UNREACHABLE'}) — cần kiểm tra đối soát nếu bệnh nhân đã chuyển khoản.`,
        );
      }
    }

    // Tự phục hồi các hoá đơn còn 'pending' nhưng đã có giao dịch 'success'
    const stuckInvoices = await this.prisma.invoice.findMany({
      where: {
        status: 'pending',
        payments: { some: { status: 'success' } },
      },
      select: { invoiceId: true },
      take: 100,
    });

    let healedInvoices = 0;
    for (const inv of stuckInvoices) {
      const updated = await this.invoiceService.markPaidIfSettled(inv.invoiceId);
      if (updated?.status === 'paid') {
        healedInvoices += 1;
      }
    }

    if (settledCount > 0 || failedCount > 0 || healedInvoices > 0 || stalePendingCount > 0) {
      this.logger.log(
        `Đối soát PayOS hoàn tất: settled=${settledCount}, failed/expired=${failedCount}, healedInvoices=${healedInvoices}, stalePendingOver15m=${stalePendingCount}`,
      );
    }

    return { settledCount, failedCount, healedInvoices, stalePendingCount };
  }

  /** GET /payments?invoiceId= — đã login. */
  async findByInvoice(invoiceId: string) {
    return this.prisma.payment.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'desc' },
      include: { gatewayTransaction: true },
    });
  }

  /**
   * Sinh orderCode duy nhất trực tiếp từ PostgreSQL SEQUENCE (`payos_order_code_seq`).
   * Fallback sang mã 15 chữ số (epoch millis + random + check DB) nếu môi trường chưa chạy migration sequence.
   */
  private async generateUniqueOrderCode(): Promise<number> {
    if (typeof this.prisma.$queryRaw === 'function') {
      try {
        const rows = await this.prisma.$queryRaw<Array<{ order_code: string | bigint | number }>>`
          SELECT nextval('payos_order_code_seq') AS order_code
        `;
        const nextVal = rows?.[0]?.order_code;
        if (nextVal !== undefined && nextVal !== null) {
          const parsed = Number(nextVal);
          if (Number.isSafeInteger(parsed) && parsed > 0) {
            return parsed;
          }
        }
      } catch (err) {
        this.logger.warn(
          `Không thể lấy nextval('payos_order_code_seq'), chuyển sang fallback sinh orderCode: ${(err as Error)?.message}`,
        );
      }
    }

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = Date.now() * 100 + randomInt(10, 100);
      const existing = await this.prisma.paymentGatewayTransaction.findFirst({
        where: {
          provider: 'payos',
          requestPayload: { path: ['orderCode'], equals: candidate },
        },
        select: { gatewayTransactionId: true },
      });
      if (!existing) {
        return candidate;
      }
    }
    throw new BadRequestException('Không thể sinh mã giao dịch PayOS duy nhất, vui lòng thử lại.');
  }

  /**
   * Tra cứu PaymentGatewayTransaction cho webhook PayOS:
   * 1. Ưu tiên dùng khóa unique (provider, providerTransactionRef = paymentLinkId).
   * 2. Fallback theo orderCode trong requestPayload, nhưng từ chối cập nhật nếu phát hiện > 1 bản ghi trùng.
   */
  private async findPayOsTransactionForWebhook(paymentLinkId: string | undefined, orderCode: any) {
    if (paymentLinkId && typeof this.prisma.paymentGatewayTransaction.findUnique === 'function') {
      const byUniqueRef = await this.prisma.paymentGatewayTransaction.findUnique({
        where: {
          provider_providerTransactionRef: {
            provider: 'payos',
            providerTransactionRef: paymentLinkId,
          },
        },
        include: { payment: { include: { invoice: true } } },
      });
      if (byUniqueRef) {
        return byUniqueRef;
      }
    }

    if (orderCode === undefined || orderCode === null) {
      this.logger.warn('Webhook PayOS: thiếu cả paymentLinkId và orderCode.');
      return null;
    }

    if (typeof this.prisma.paymentGatewayTransaction.findMany === 'function') {
      const matches = await this.prisma.paymentGatewayTransaction.findMany({
        where: {
          provider: 'payos',
          requestPayload: { path: ['orderCode'], equals: orderCode },
        },
        include: { payment: { include: { invoice: true } } },
        take: 2,
      });

      if (matches.length === 0) {
        this.logger.warn(`Webhook PayOS: không tìm thấy giao dịch ứng với orderCode=${orderCode}.`);
        return null;
      }
      if (matches.length > 1) {
        this.logger.error(
          `Webhook PayOS: phát hiện nhiều hơn 1 giao dịch trùng orderCode=${orderCode} — bỏ qua tự động cập nhật để tránh lệch hoá đơn.`,
        );
        return null;
      }
      return matches[0];
    }

    const fallback = await this.prisma.paymentGatewayTransaction.findFirst({
      where: {
        provider: 'payos',
        requestPayload: { path: ['orderCode'], equals: orderCode },
      },
      include: { payment: { include: { invoice: true } } },
    });
    if (!fallback) {
      this.logger.warn(`Webhook PayOS: không tìm thấy giao dịch ứng với orderCode=${orderCode}.`);
      return null;
    }
    return fallback;
  }

  /**
   * Cập nhật atomic PaymentGatewayTransaction + Payment thành 'success' trong cùng 1 transaction,
   * kiểm tra khớp số tiền và trạng thái hoá đơn trước khi gọi markPaidIfSettled.
   */
  private async settleBankTransferPayment(params: {
    paymentId: string;
    gatewayTransactionId: string;
    invoiceId: string;
    expectedAmount: number;
    gatewayPayload: any;
    paidAmount?: number;
    invoiceStatus?: string;
  }): Promise<boolean> {
    if (params.paidAmount !== undefined && params.paidAmount < params.expectedAmount) {
      this.logger.error(
        `Đối soát PayOS LỆCH SỐ TIỀN cho Payment ${params.paymentId}: ` +
          `kỳ vọng ${params.expectedAmount}, thực nhận ${params.paidAmount}.`,
      );
      return false;
    }

    if (params.invoiceStatus === 'cancelled' || params.invoiceStatus === 'refunded') {
      this.logger.error(
        `Đối soát PayOS: giao dịch ${params.paymentId} đã PAID nhưng hoá đơn ${params.invoiceId} đang '${params.invoiceStatus}' — cần hoàn tiền thủ công.`,
      );
      return false;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.paymentGatewayTransaction.update({
        where: { gatewayTransactionId: params.gatewayTransactionId },
        data: {
          responsePayload: params.gatewayPayload,
          completedAt: new Date(),
          status: 'success',
        },
      });
      await tx.payment.updateMany({
        where: { paymentId: params.paymentId, status: { not: 'success' } },
        data: { status: 'success', paidAt: new Date() },
      });
    });

    await this.invoiceService.markPaidIfSettled(params.invoiceId);
    return true;
  }
}
