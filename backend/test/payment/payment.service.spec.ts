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
        update: jest.fn(),
      },
      patient: { findUnique: jest.fn() },
      paymentGatewayTransaction: {
        create: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      invoice: { findUnique: jest.fn() },
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
  });

  // ------------------------------------------------------------------ handlePayOsWebhook
  describe('handlePayOsWebhook', () => {
    const webhookDto = {
      code: '00',
      desc: 'success',
      success: true,
      data: { orderCode: 123456789, amount: 250000 },
      signature: 'valid-sig',
    } as any;

    it('ném BadRequestException khi chữ ký PayOS không hợp lệ', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(false);
      await expect(service.handlePayOsWebhook(webhookDto)).rejects.toThrow(BadRequestException);
    });

    it('trả { received: true } khi chữ ký hợp lệ nhưng không khớp transaction nào', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(true);
      prisma.paymentGatewayTransaction.findFirst.mockResolvedValue(null);

      const res = await service.handlePayOsWebhook(webhookDto);
      expect(res).toEqual({ received: true });
      expect(prisma.payment.update).not.toHaveBeenCalled();
    });

    it('cập nhật payment success và gọi markPaidIfSettled khi webhook thành công (code 00)', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(true);
      prisma.paymentGatewayTransaction.findFirst.mockResolvedValue({ paymentId: 'pay-01' });
      prisma.paymentGatewayTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.update.mockResolvedValue({ paymentId: 'pay-01', invoiceId: 'inv-01', status: 'success' });

      const res = await service.handlePayOsWebhook(webhookDto);

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { paymentId: 'pay-01' },
        data: { status: 'success', paidAt: expect.any(Date) },
      });
      expect(invoiceService.markPaidIfSettled).toHaveBeenCalledWith('inv-01');
      expect(res).toEqual({ received: true });
    });

    it('cập nhật payment failed và không gọi markPaidIfSettled khi webhook báo thất bại', async () => {
      paymentGateway.verifyWebhookSignature.mockReturnValue(true);
      prisma.paymentGatewayTransaction.findFirst.mockResolvedValue({ paymentId: 'pay-01' });
      prisma.paymentGatewayTransaction.updateMany.mockResolvedValue({ count: 1 });
      prisma.payment.update.mockResolvedValue({ paymentId: 'pay-01', status: 'failed' });

      const res = await service.handlePayOsWebhook({ ...webhookDto, success: false, code: '01' });

      expect(prisma.payment.update).toHaveBeenCalledWith({
        where: { paymentId: 'pay-01' },
        data: { status: 'failed' },
      });
      expect(invoiceService.markPaidIfSettled).not.toHaveBeenCalled();
      expect(res).toEqual({ received: true });
    });
  });
});
