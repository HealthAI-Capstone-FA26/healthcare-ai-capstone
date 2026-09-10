import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { hasPermissionScope } from '../../../common/utils/permission.util';
import { InvoiceService } from '../invoice/invoice.service';
import { ActorRoleService } from '../../user/actor-role.service';
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

    // §3.2b bước 3 — PayOS yêu cầu orderCode là số nguyên (int), không dùng UUID được.
    // Cắt 9 chữ số cuối của epoch millis để vừa giới hạn PayOS mà vẫn gần như unique.
    const orderCode = Number(String(Date.now()).slice(-9));
    // PayOS giới hạn description ngắn (~25 ký tự) -> cắt gọn, chỉ giữ mã hoá đơn.
    const description = `Thanh toan HD ${invoice.invoiceCode}`.slice(0, 25);
    const cancelUrl = this.configService.get<string>('PAYOS_CANCEL_URL') ?? '';
    const returnUrl = this.configService.get<string>('PAYOS_RETURN_URL') ?? '';

    let checkoutUrl: string;
    let paymentLinkId: string;
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
        qrCodeData: checkoutUrl,
        requestPayload: { orderCode, amount: remaining, description, cancelUrl, returnUrl },
        status: 'initiated',
        initiatedAt: new Date(),
      },
    });

    return { paymentId: payment.paymentId, checkoutUrl };
  }

  /**
   * POST /payments/bank-transfer/webhook — §3.3. KHÔNG guard (route nằm ở PaymentWebhookController
   * riêng, xem payment-webhook.controller.ts) — bảo vệ bằng xác thực signature ở đây.
   * Dùng chung §3.4 markPaidIfSettled với cash-confirm, không viết lại logic side-effects.
   */
  async handlePayOsWebhook(dto: PayOsWebhookDto) {
    // 2. Xác thực signature -> sai thì 400, KHÔNG xử lý tiếp.
    const isValidSignature = this.paymentGateway.verifyWebhookSignature(dto.data, dto.signature);
    if (!isValidSignature) {
      throw new BadRequestException('Chữ ký PayOS không hợp lệ.');
    }

    const orderCode = dto.data?.orderCode;

    // 3. Tìm PaymentGatewayTransaction theo orderCode lưu trong requestPayload (Postgres JSONB).
    const transaction = await this.prisma.paymentGatewayTransaction.findFirst({
      where: { requestPayload: { path: ['orderCode'], equals: orderCode } },
    });

    if (!transaction) {
      this.logger.warn(`Webhook PayOS: không tìm thấy giao dịch ứng với orderCode=${orderCode}.`);
      // 7. Chữ ký hợp lệ -> vẫn trả 200 để PayOS không retry vô hạn, dù không khớp giao dịch nào.
      return { received: true };
    }

    const isSuccess = dto.success === true && dto.code === '00';

    // 4. Cập nhật responsePayload, completedAt.
    await this.prisma.paymentGatewayTransaction.updateMany({
      where: { requestPayload: { path: ['orderCode'], equals: orderCode } },
      data: {
        responsePayload: dto.data,
        completedAt: new Date(),
        status: isSuccess ? 'success' : 'failed',
      },
    });

    if (isSuccess) {
      // 5. success===true && code==='00' -> Payment.status='success', paidAt=now -> §3.4.
      const updatedPayment = await this.prisma.payment.update({
        where: { paymentId: transaction.paymentId },
        data: { status: 'success', paidAt: new Date() },
      });
      await this.invoiceService.markPaidIfSettled(updatedPayment.invoiceId);
    } else {
      // 6. Ngược lại -> Payment.status='failed', Invoice giữ 'pending' để cho phép tạo Payment mới.
      await this.prisma.payment.update({
        where: { paymentId: transaction.paymentId },
        data: { status: 'failed' },
      });
    }

    // 7. Luôn trả 200 cho payload đã xác thực chữ ký hợp lệ.
    return { received: true };
  }

  /** GET /payments/:id — đã login. */
  async getById(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { paymentId },
      include: { gatewayTransaction: true },
    });
    if (!payment) {
      throw new NotFoundException(`Không tìm thấy giao dịch thanh toán ${paymentId}`);
    }
    return payment;
  }

  /** GET /payments?invoiceId= — đã login. */
  async findByInvoice(invoiceId: string) {
    return this.prisma.payment.findMany({
      where: { invoiceId },
      orderBy: { createdAt: 'desc' },
      include: { gatewayTransaction: true },
    });
  }
}
