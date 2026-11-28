import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PaymentService } from '../../src/modules/payment/payment/payment.service';
import { ACTOR_ROLE } from '../../src/common/constants/actor-role.constant';

describe('PaymentService (F-08 Cash & PayOS Payment)', () => {
  let service: PaymentService;
  let prisma: any;
  let invoiceService: any;
  let actorRoleService: any;
  let configService: any;
  let paymentGateway: any;

  const pendingInvoice = {
    invoiceId: 'inv-01',
    invoiceCode: 'HD001',
    patientId: 'pat-01',
    status: 'pending',
    totalAmount: 250000,
    payments: [],
  };

  beforeEach(() => {
    prisma = {
      payment: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      patient: { findUnique: jest.fn() },
      paymentGatewayTransaction: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      invoice: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      $queryRaw: jest.fn(),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    invoiceService = {
      findById: jest.fn().mockResolvedValue(pendingInvoice),
      markPaidIfSettled: jest.fn().mockResolvedValue({ ...pendingInvoice, status: 'paid' }),
    };
    actorRoleService = {
      getActorRole: jest.fn().mockResolvedValue(ACTOR_ROLE.RECEPTIONIST),
    };
    configService = {
      get: jest.fn((key: string) => (key.includes('URL') ? 'http://localhost:5173/reception' : undefined)),
    };
    paymentGateway = {
      createPaymentLink: jest.fn(),
      verifyWebhookSignature: jest.fn(),
      getPaymentLinkInformation: jest.fn(),
    };

    service = new PaymentService(prisma, invoiceService, actorRoleService, configService, paymentGateway);
  });

  // ------------------------------------------------------------------ createCashPayment
  describe('createCashPayment', () => {
    it('tạo giao dịch tiền mặt pending khi hoá đơn pending và khớp số tiền còn thiếu', async () => {
      prisma.payment.create.mockResolvedValue({ paymentId: 'pay-01', status: 'pending', amount: 250000 });

      const res = await service.createCashPayment({ invoiceId: 'inv-01', amount: 250000 });

      expect(prisma.payment.create).toHaveBeenCalledWith({
        data: { invoiceId: 'inv-01', paymentMethod: 'cash', amount: 250000, status: 'pending' },
      });
      expect(res.paymentId).toBe('pay-01');
    });

    it('ném BadRequestException khi hoá đơn không ở trạng thái pending', async () => {
      invoiceService.findById.mockResolvedValue({ ...pendingInvoice, status: 'paid' });
      await expect(service.createCashPayment({ invoiceId: 'inv-01', amount: 250000 })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ném BadRequestException khi số tiền không khớp phần còn thiếu', async () => {
      await expect(service.createCashPayment({ invoiceId: 'inv-01', amount: 100000 })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ------------------------------------------------------------------ confirmCashPayment
  describe('confirmCashPayment', () => {
    it('xác nhận giao dịch tiền mặt pending -> success và gọi markPaidIfSettled', async () => {
      const cashPayment = {
        paymentId: 'pay-01',
        invoiceId: 'inv-01',
        paymentMethod: 'cash',
        status: 'pending',
      };
      prisma.payment.findUnique
        .mockResolvedValueOnce(cashPayment)
        .mockResolvedValueOnce({ ...cashPayment, status: 'success', gatewayTransaction: null });
      prisma.payment.update.mockResolvedValue({ ...cashPayment, status: 'success' });

      const res = await service.confirmCashPayment('pay-01', {}, 'rec-user-01');

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { paymentId: 'pay-01' },
        data: { status: 'success', paidAt: expect.any(Date), receivedByUserId: 'rec-user-01' },
      });
      expect(invoiceService.markPaidIfSettled).toHaveBeenCalledWith('inv-01');
      expect(res.status).toBe('success');
    });

    it('ném NotFoundException nếu không tìm thấy payment', async () => {
      prisma.payment.findUnique.mockResolvedValue(null);
      await expect(service.confirmCashPayment('missing', {}, 'rec-01')).rejects.toThrow(NotFoundException);
    });

    it('ném ForbiddenException nếu giao dịch không phải tiền mặt (cash)', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        paymentId: 'pay-01',
        paymentMethod: 'bank_transfer',
        status: 'pending',
      });
      await expect(service.confirmCashPayment('pay-01', {}, 'rec-01')).rejects.toThrow(ForbiddenException);
    });

    it('ném BadRequestException nếu giao dịch không ở trạng thái pending', async () => {
      prisma.payment.findUnique.mockResolvedValue({
        paymentId: 'pay-01',
        paymentMethod: 'cash',
        status: 'success',
      });
      await expect(service.confirmCashPayment('pay-01', {}, 'rec-01')).rejects.toThrow(BadRequestException);
    });
  });

  // ------------------------------------------------------------------ createBankTransferPayment (PayOS)
  describe('createBankTransferPayment', () => {
    const receptionistUser = { userId: 'u-rec', permissions: ['payment:create:all'] } as any;
    const patientUser = { userId: 'u-pat', permissions: ['payment:create:own'] } as any;

    it('RECEPTIONIST tạo link PayOS thành công và lưu PaymentGatewayTransaction', async () => {
      prisma.payment.create.mockResolvedValue({ paymentId: 'pay-payos-1', status: 'pending' });
      paymentGateway.createPaymentLink.mockResolvedValue({
        checkoutUrl: 'https://pay.payos.vn/web/123',
        paymentLinkId: 'plink-123',
        qrCode: '000201010212...',
        accountNumber: '123456',
        accountName: 'CLINIC 4AM',
        bin: '970422',
      });
      prisma.paymentGatewayTransaction.create.mockResolvedValue({});

      const res = await service.createBankTransferPayment({ invoiceId: 'inv-01' }, receptionistUser);

      expect(paymentGateway.createPaymentLink).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 250000, description: 'Thanh toan HD HD001' }),
      );
      expect(prisma.paymentGatewayTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            paymentId: 'pay-payos-1',
            provider: 'payos',
            providerTransactionRef: 'plink-123',
            status: 'initiated',
          }),
        }),
      );
      expect(res.checkoutUrl).toBe('https://pay.payos.vn/web/123');
    });

    it('PATIENT thanh toán hoá đơn của người khác -> ném ForbiddenException', async () => {
      actorRoleService.getActorRole.mockResolvedValue(ACTOR_ROLE.PATIENT);
      prisma.patient.findUnique.mockResolvedValue({ patientId: 'pat-other' });

      await expect(service.createBankTransferPayment({ invoiceId: 'inv-01' }, patientUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('ném BadRequestException khi hoá đơn đã thanh toán đủ (remaining <= 0)', async () => {
      invoiceService.findById.mockResolvedValue({
        ...pendingInvoice,
        payments: [{ status: 'success', amount: 250000 }],
      });

      await expect(service.createBankTransferPayment({ invoiceId: 'inv-01' }, receptionistUser)).rejects.toThrow(
        new BadRequestException('Hoá đơn đã được thanh toán đủ.'),
      );
    });

    it('đánh dấu Payment failed nếu gọi PayOS tạo link thất bại', async () => {
      prisma.payment.create.mockResolvedValue({ paymentId: 'pay-fail', status: 'pending' });
      paymentGateway.createPaymentLink.mockRejectedValue(new Error('PayOS timeout'));

      await expect(
        service.createBankTransferPayment({ invoiceId: 'inv-01' }, receptionistUser),
      ).rejects.toThrow('PayOS timeout');

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { paymentId: 'pay-fail' },
        data: { status: 'failed' },
      });
    });

    it('sinh orderCode duy nhất từ PostgreSQL sequence payos_order_code_seq', async () => {
      prisma.payment.create.mockResolvedValue({ paymentId: 'pay-seq', status: 'pending' });
      prisma.$queryRaw.mockResolvedValue([{ order_code: BigInt(1000000042) }]);
      paymentGateway.createPaymentLink.mockResolvedValue({
        checkoutUrl: 'https://pay.payos.vn/web/seq',
        paymentLinkId: 'plink-seq',
      });
      prisma.paymentGatewayTransaction.create.mockResolvedValue({});

      await service.createBankTransferPayment({ invoiceId: 'inv-01' }, receptionistUser);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(paymentGateway.createPaymentLink).toHaveBeenCalledWith(
        expect.objectContaining({ orderCode: 1000000042 }),
      );
    });

    it('thử lại sinh orderCode mới khi fallback và phát hiện trùng trong DB', async () => {
      prisma.payment.create.mockResolvedValue({ paymentId: 'pay-retry', status: 'pending' });
      prisma.$queryRaw.mockRejectedValue(new Error('sequence not found'));
      prisma.paymentGatewayTransaction.findFirst
        .mockResolvedValueOnce({ gatewayTransactionId: 'gtx-existing' })
        .mockResolvedValueOnce(null);
      paymentGateway.createPaymentLink.mockResolvedValue({
        checkoutUrl: 'https://pay.payos.vn/web/456',
        paymentLinkId: 'plink-456',
      });
      prisma.paymentGatewayTransaction.create.mockResolvedValue({});

      await service.createBankTransferPayment({ invoiceId: 'inv-01' }, receptionistUser);

      expect(prisma.paymentGatewayTransaction.findFirst).toHaveBeenCalledTimes(2);
      const calledOrderCode = paymentGateway.createPaymentLink.mock.calls[0][0].orderCode;
      expect(Number.isSafeInteger(calledOrderCode)).toBe(true);
      expect(String(calledOrderCode).length).toBeGreaterThanOrEqual(15);
    });
  });

  // ------------------------------------------------------------------ handlePayOsWebhook
  describe('handlePayOsWebhook', () => {
    const webhookDto = {
      code: '00',
      desc: 'success',
      success: true,
      data: { orderCode: 176428927812345, paymentLinkId: 'plink-123', amount: 250000 },
      signature: 'valid-sig',
    } as any;

    const baseTx = {
      gatewayTransactionId: 'gtx-01',
      paymentId: 'pay-01',
      status: 'initiated',
      payment: {
        paymentId: 'pay-01',
        invoiceId: 'inv-01',
        amount: 250000,
        status: 'pending',
        invoice: { invoiceId: 'inv-01', status: 'pending' },
      },
    };

    it('ném BadRequestException khi chữ ký PayOS không hợp lệ', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(false);
      await expect(service.handlePayOsWebhook(webhookDto)).rejects.toThrow(BadRequestException);
    });

    it('trả { received: true } khi chữ ký hợp lệ nhưng không khớp transaction nào', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(true);
      prisma.paymentGatewayTransaction.findUnique.mockResolvedValue(null);
      prisma.paymentGatewayTransaction.findMany.mockResolvedValue([]);

      const res = await service.handlePayOsWebhook(webhookDto);
      expect(res).toEqual({ received: true });
      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
    });

    it('ưu tiên tra theo khóa unique (provider, paymentLinkId), cập nhật atomic và gọi markPaidIfSettled', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(true);
      prisma.paymentGatewayTransaction.findUnique.mockResolvedValue(baseTx);
      prisma.paymentGatewayTransaction.update.mockResolvedValue({});
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.handlePayOsWebhook(webhookDto);

      expect(prisma.paymentGatewayTransaction.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            provider_providerTransactionRef: {
              provider: 'payos',
              providerTransactionRef: 'plink-123',
            },
          },
        }),
      );
      expect(prisma.paymentGatewayTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { gatewayTransactionId: 'gtx-01' },
          data: expect.objectContaining({ status: 'success' }),
        }),
      );
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { paymentId: 'pay-01', status: { not: 'success' } },
        data: { status: 'success', paidAt: expect.any(Date) },
      });
      expect(invoiceService.markPaidIfSettled).toHaveBeenCalledWith('inv-01');
      expect(res).toEqual({ received: true });
    });

    it('cập nhật payment failed (chỉ khi đang pending) và không gọi markPaidIfSettled khi webhook báo thất bại', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(true);
      prisma.paymentGatewayTransaction.findUnique.mockResolvedValue(baseTx);
      prisma.paymentGatewayTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.handlePayOsWebhook({ ...webhookDto, success: false, code: '01' });

      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { paymentId: 'pay-01', status: 'pending' },
        data: { status: 'failed' },
      });
      expect(invoiceService.markPaidIfSettled).not.toHaveBeenCalled();
      expect(res).toEqual({ received: true });
    });

    it('không hạ trạng thái Payment từ success xuống failed khi callback thất bại đến trễ (out-of-order)', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(true);
      prisma.paymentGatewayTransaction.findUnique.mockResolvedValue({
        ...baseTx,
        status: 'success',
        payment: {
          ...baseTx.payment,
          status: 'success',
          invoice: { invoiceId: 'inv-01', status: 'paid' },
        },
      });

      const res = await service.handlePayOsWebhook({ ...webhookDto, success: false, code: '01' });

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(prisma.paymentGatewayTransaction.updateMany).not.toHaveBeenCalled();
      expect(invoiceService.markPaidIfSettled).not.toHaveBeenCalled();
      expect(res).toEqual({ received: true });
    });

    it('tự gọi lại markPaidIfSettled khi nhận duplicate webhook cho Payment đã success nhưng Invoice còn kẹt pending', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(true);
      prisma.paymentGatewayTransaction.findUnique.mockResolvedValue({
        ...baseTx,
        status: 'success',
        payment: {
          ...baseTx.payment,
          status: 'success',
          invoice: { invoiceId: 'inv-01', status: 'pending' },
        },
      });

      const res = await service.handlePayOsWebhook(webhookDto);

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(invoiceService.markPaidIfSettled).toHaveBeenCalledWith('inv-01');
      expect(res).toEqual({ received: true });
    });

    it('từ chối đánh dấu paid nếu số tiền webhook không khớp Payment.amount', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(true);
      prisma.paymentGatewayTransaction.findUnique.mockResolvedValue(baseTx);
      prisma.paymentGatewayTransaction.update.mockResolvedValue({});

      const res = await service.handlePayOsWebhook({
        ...webhookDto,
        data: { ...webhookDto.data, amount: 100000 },
      });

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(invoiceService.markPaidIfSettled).not.toHaveBeenCalled();
      expect(prisma.paymentGatewayTransaction.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { gatewayTransactionId: 'gtx-01' },
          data: expect.objectContaining({
            responsePayload: expect.objectContaining({ _mismatchReason: 'amount_mismatch' }),
          }),
        }),
      );
      expect(res).toEqual({ received: true });
    });

    it('không tự mở khóa hoá đơn đã bị cancelled khi webhook thành công đến trễ', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(true);
      prisma.paymentGatewayTransaction.findUnique.mockResolvedValue({
        ...baseTx,
        payment: {
          ...baseTx.payment,
          invoice: { invoiceId: 'inv-01', status: 'cancelled' },
        },
      });
      prisma.paymentGatewayTransaction.update.mockResolvedValue({});

      const res = await service.handlePayOsWebhook(webhookDto);

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(invoiceService.markPaidIfSettled).not.toHaveBeenCalled();
      expect(res).toEqual({ received: true });
    });

    it('từ chối tự động cập nhật nếu fallback orderCode khớp nhiều hơn 1 giao dịch', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(true);
      prisma.paymentGatewayTransaction.findMany.mockResolvedValue([baseTx, { ...baseTx, gatewayTransactionId: 'gtx-02' }]);

      const res = await service.handlePayOsWebhook({
        ...webhookDto,
        data: { orderCode: 123456789, amount: 250000 },
      });

      expect(prisma.payment.updateMany).not.toHaveBeenCalled();
      expect(invoiceService.markPaidIfSettled).not.toHaveBeenCalled();
      expect(res).toEqual({ received: true });
    });

    it('xử lý an toàn khi 2 webhook thành công đến đồng thời (simultaneous callbacks)', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(true);
      prisma.paymentGatewayTransaction.findUnique.mockResolvedValue(baseTx);
      prisma.paymentGatewayTransaction.update.mockResolvedValue({});

      // Mô phỏng atomic updateMany ở DB: chỉ request đầu tiên cập nhật được count = 1, request thứ 2 count = 0
      prisma.payment.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      const [res1, res2] = await Promise.all([
        service.handlePayOsWebhook(webhookDto),
        service.handlePayOsWebhook(webhookDto),
      ]);

      expect(res1).toEqual({ received: true });
      expect(res2).toEqual({ received: true });
      expect(prisma.payment.updateMany).toHaveBeenCalledWith({
        where: { paymentId: 'pay-01', status: { not: 'success' } },
        data: { status: 'success', paidAt: expect.any(Date) },
      });
      expect(invoiceService.markPaidIfSettled).toHaveBeenCalledWith('inv-01');
    });
  });

  // ------------------------------------------------------------------ reconcilePendingPayments
  describe('reconcilePendingPayments', () => {
    it('đồng bộ Payment pending đã PAID, đánh dấu EXPIRED thành failed, cảnh báo pending > 15 phút và phục hồi Invoice bị kẹt', async () => {
      const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
      prisma.payment.findMany.mockResolvedValue([
        {
          paymentId: 'pay-paid',
          invoiceId: 'inv-paid',
          amount: 250000,
          status: 'pending',
          createdAt: new Date(),
          invoice: { invoiceId: 'inv-paid', status: 'pending' },
          gatewayTransaction: {
            gatewayTransactionId: 'gtx-paid',
            requestPayload: { orderCode: 111 },
          },
        },
        {
          paymentId: 'pay-exp',
          invoiceId: 'inv-exp',
          amount: 100000,
          status: 'pending',
          createdAt: new Date(),
          invoice: { invoiceId: 'inv-exp', status: 'pending' },
          gatewayTransaction: {
            gatewayTransactionId: 'gtx-exp',
            requestPayload: { orderCode: 222 },
          },
        },
        {
          paymentId: 'pay-stale',
          invoiceId: 'inv-stale',
          amount: 300000,
          status: 'pending',
          createdAt: twentyMinsAgo,
          invoice: { invoiceId: 'inv-stale', status: 'pending' },
          gatewayTransaction: {
            gatewayTransactionId: 'gtx-stale',
            requestPayload: { orderCode: 333 },
          },
        },
      ]);
      paymentGateway.getPaymentLinkInformation
        .mockResolvedValueOnce({ status: 'PAID', amountPaid: 250000 })
        .mockResolvedValueOnce({ status: 'EXPIRED' })
        .mockResolvedValueOnce({ status: 'PENDING' });
      prisma.paymentGatewayTransaction.update.mockResolvedValue({});
      prisma.paymentGatewayTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.updateMany.mockResolvedValue({ count: 1 });
      prisma.invoice.findMany.mockResolvedValue([{ invoiceId: 'inv-stuck' }]);

      const res = await service.reconcilePendingPayments();

      expect(res).toEqual({
        settledCount: 1,
        failedCount: 1,
        healedInvoices: 1,
        stalePendingCount: 1,
      });
      expect(invoiceService.markPaidIfSettled).toHaveBeenCalledWith('inv-paid');
      expect(invoiceService.markPaidIfSettled).toHaveBeenCalledWith('inv-stuck');
    });
  });
});
