import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceService } from '../../src/modules/payment/invoice/invoice.service';
import { INVOICE_PAID_EVENT } from '../../src/modules/payment/invoice/events/invoice-paid.event';

describe('InvoiceService (F-08 Invoice Management)', () => {
  let service: InvoiceService;
  let prisma: any;
  let examinationFeeService: any;
  let labTaskPaymentNotifier: any;
  let invoicePdfGenerator: any;
  let notificationDispatcher: any;
  let eventEmitter: any;

  const baseAppointment = {
    appointmentId: 'apt-01',
    patientId: 'pat-01',
    appointmentType: 'standard',
  };

  const baseEncounter = {
    encounterId: 'enc-01',
    appointmentId: 'apt-01',
    appointment: baseAppointment,
  };

  beforeEach(() => {
    prisma = {
      encounter: { findUnique: jest.fn() },
      appointment: { findUnique: jest.fn() },
      invoiceItem: { findFirst: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn() },
      diagnosticOrderItem: { findMany: jest.fn() },
      invoice: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      patient: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    examinationFeeService = { findActiveFee: jest.fn() };
    labTaskPaymentNotifier = { verifyPaymentByOrderItemId: jest.fn().mockResolvedValue(undefined) };
    invoicePdfGenerator = { generateAndUpload: jest.fn().mockResolvedValue('https://cdn.local/inv.pdf') };
    notificationDispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) };
    eventEmitter = { emit: jest.fn() };

    service = new InvoiceService(
      prisma,
      examinationFeeService,
      labTaskPaymentNotifier,
      invoicePdfGenerator,
      notificationDispatcher,
      eventEmitter,
    );
  });

  // ------------------------------------------------------------------ generate
  describe('generate', () => {
    it('ném BadRequestException nếu thiếu cả encounterId và appointmentId', async () => {
      await expect(service.generate({} as any)).rejects.toThrow(
        new BadRequestException('Cần cung cấp encounterId hoặc appointmentId'),
      );
    });

    it('ném BadRequestException nếu truyền đồng thời cả encounterId và appointmentId', async () => {
      await expect(service.generate({ encounterId: 'enc-01', appointmentId: 'apt-01' })).rejects.toThrow(
        new BadRequestException('Chỉ được cung cấp một trong encounterId hoặc appointmentId'),
      );
    });

    it('ném NotFoundException khi không tìm thấy encounter', async () => {
      prisma.encounter.findUnique.mockResolvedValue(null);
      await expect(service.generate({ encounterId: 'missing-enc' })).rejects.toThrow(NotFoundException);
    });

    it('ném BadRequestException khi không có mục chi phí mới để lập hoá đơn', async () => {
      prisma.encounter.findUnique.mockResolvedValue(baseEncounter);
      prisma.invoiceItem.findFirst.mockResolvedValue({ invoiceItemId: 'item-old' });
      prisma.diagnosticOrderItem.findMany.mockResolvedValue([]);

      await expect(service.generate({ encounterId: 'enc-01' })).rejects.toThrow(BadRequestException);
    });

    it('lập hoá đơn gồm phí khám + dịch vụ CLS, tính tổng sau giảm giá và gửi thông báo', async () => {
      prisma.encounter.findUnique.mockResolvedValue(baseEncounter);
      prisma.invoiceItem.findFirst.mockResolvedValue(null);
      examinationFeeService.findActiveFee.mockResolvedValue({
        feeId: 'fee-1',
        feeName: 'Khám Tim mạch',
        price: 150000,
      });
      prisma.diagnosticOrderItem.findMany.mockResolvedValue([
        { orderItemId: 'oi-1', unitPrice: 200000, service: { serviceName: 'ECG 2 chuyển đạo' } },
      ]);
      prisma.invoice.findUnique
        .mockResolvedValueOnce(null) // generateUniqueCode check
        .mockResolvedValueOnce({
          invoiceId: 'inv-01',
          invoiceCode: 'HD0001',
          totalAmount: 300000,
          status: 'pending',
          items: [],
          payments: [],
        });
      prisma.invoice.create.mockResolvedValue({ invoiceId: 'inv-01' });
      prisma.invoiceItem.createMany.mockResolvedValue({ count: 2 });
      prisma.patient.findUnique.mockResolvedValue({ email: 'patient@clinic.vn' });

      const res = await service.generate({ encounterId: 'enc-01', discountAmount: 50000 });

      expect(prisma.invoice.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            encounterId: 'enc-01',
            appointmentId: 'apt-01',
            patientId: 'pat-01',
            invoiceType: 'other',
            subtotalAmount: 350000,
            discountAmount: 50000,
            totalAmount: 300000,
            status: 'pending',
          }),
        }),
      );
      expect(notificationDispatcher.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ notificationType: 'invoice_issued', referenceId: 'inv-01' }),
        ['email', 'in_app'],
      );
      expect(res.invoiceId).toBe('inv-01');
    });
  });

  // ------------------------------------------------------------------ findById
  describe('findById', () => {
    it('ném NotFoundException khi không tìm thấy hoá đơn', async () => {
      prisma.invoice.findUnique.mockResolvedValue(null);
      await expect(service.findById('missing-inv')).rejects.toThrow(NotFoundException);
    });
  });

  // ------------------------------------------------------------------ cancel
  describe('cancel', () => {
    it('ném BadRequestException nếu hoá đơn không ở trạng thái pending', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        invoiceId: 'inv-01',
        status: 'paid',
        payments: [],
        items: [],
      });
      await expect(service.cancel('inv-01', {})).rejects.toThrow(BadRequestException);
    });

    it('ném BadRequestException nếu hoá đơn đã có giao dịch success', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        invoiceId: 'inv-01',
        status: 'pending',
        payments: [{ status: 'success' }],
        items: [],
      });
      await expect(service.cancel('inv-01', {})).rejects.toThrow(
        new BadRequestException('Không thể huỷ hoá đơn đã có giao dịch thanh toán thành công.'),
      );
    });

    it('huỷ hoá đơn pending và giải phóng các dòng CLS để có thể lập lại hoá đơn', async () => {
      prisma.invoice.findUnique.mockResolvedValue({
        invoiceId: 'inv-01',
        status: 'pending',
        payments: [],
        items: [],
      });
      prisma.invoiceItem.deleteMany.mockResolvedValue({ count: 1 });
      prisma.invoice.update.mockResolvedValue({ invoiceId: 'inv-01', status: 'cancelled' });

      const res = await service.cancel('inv-01', { cancelReason: 'Bệnh nhân đổi chỉ định' });

      expect(prisma.invoiceItem.deleteMany).toHaveBeenCalledWith({
        where: { invoiceId: 'inv-01', orderItemId: { not: null } },
      });
      expect(prisma.invoice.update).toHaveBeenCalledWith({
        where: { invoiceId: 'inv-01' },
        data: { status: 'cancelled' },
      });
      expect(res.status).toBe('cancelled');
    });
  });

  // ------------------------------------------------------------------ markPaidIfSettled
  describe('markPaidIfSettled', () => {
    it('không chuyển paid nếu tổng tiền đã thu chưa đủ', async () => {
      const partial = {
        invoiceId: 'inv-01',
        patientId: 'pat-01',
        status: 'pending',
        totalAmount: 300000,
        payments: [{ status: 'success', amount: 100000 }],
        items: [],
      };
      prisma.invoice.findUnique.mockResolvedValue(partial);

      const res = await service.markPaidIfSettled('inv-01');

      expect(prisma.invoice.updateMany).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
      expect(res).toEqual(partial);
    });

    it('chuyển paid atomically, verify LabTask cho CLS, sinh PDF và phát event invoice.paid', async () => {
      const settled = {
        invoiceId: 'inv-01',
        invoiceCode: 'HD0001',
        patientId: 'pat-01',
        status: 'pending',
        totalAmount: 200000,
        pdfFileUrl: 'https://cdn.local/existing.pdf',
        payments: [{ status: 'success', amount: 200000 }],
        items: [{ orderItemId: 'oi-1' }, { examinationFeeId: 'fee-1', orderItemId: null }],
      };
      prisma.invoice.findUnique
        .mockResolvedValueOnce(settled)
        .mockResolvedValueOnce(settled) // ensurePdfGenerated
        .mockResolvedValueOnce({ ...settled, status: 'paid' });
      prisma.invoice.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.markPaidIfSettled('inv-01');

      expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
        where: { invoiceId: 'inv-01', status: 'pending' },
        data: { status: 'paid' },
      });
      expect(labTaskPaymentNotifier.verifyPaymentByOrderItemId).toHaveBeenCalledWith('oi-1');
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        INVOICE_PAID_EVENT,
        expect.objectContaining({ invoiceId: 'inv-01', patientId: 'pat-01' }),
      );
      expect(res.status).toBe('paid');
    });
  });
});
