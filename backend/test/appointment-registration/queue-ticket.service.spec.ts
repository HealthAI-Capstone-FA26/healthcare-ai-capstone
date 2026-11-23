import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { QueueTicketService } from '../../src/modules/patient-flow/appointment-registration/queue-ticket/queue-ticket.service';
import { QUEUE_TICKET_EVENT } from '../../src/modules/patient-flow/appointment-registration/queue-ticket/queue-ticket.events';
import { compareQueueTickets } from '../../src/common/constants/queue-ticket.constants';

const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' } as any);
const p2025 = () => new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: 'test' } as any);

describe('QueueTicketService (F-04 Reception and queue)', () => {
  let service: QueueTicketService;
  let prisma: any;
  let patientService: any;
  let invoiceService: any;
  let eventEmitter: any;
  let notificationService: any;

  beforeEach(() => {
    prisma = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
      queueTicket: {
        aggregate: jest.fn().mockResolvedValue({ _max: { ticketNumber: null } }),
        create: jest.fn(async ({ data }: any) => ({ ticketId: 't-1', ticketDate: new Date('2026-11-20'), calledAt: null, counterNumber: null, ...data })),
        count: jest.fn().mockResolvedValue(3),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      appointment: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      doctor: { findUnique: jest.fn() },
      doctorSchedule: { findMany: jest.fn().mockResolvedValue([]) },
      patient: { findUnique: jest.fn() },
      receptionCheckin: { create: jest.fn() },
      invoice: { findFirst: jest.fn() },
    };
    patientService = { createDraftPatientRecord: jest.fn() };
    invoiceService = { generate: jest.fn() };
    eventEmitter = { emit: jest.fn() };
    notificationService = { enqueue: jest.fn() };
    service = new QueueTicketService(prisma, patientService, invoiceService, eventEmitter, notificationService);
  });

  afterEach(() => jest.useRealTimers());

  // ---------------------------------------------------------------- issueWalkInTicket (B)
  describe('issueWalkInTicket', () => {
    it('UTCID01 [N]: first ticket of the day -> B001 waiting, no appointment, advisory lock taken, ISSUED event emitted', async () => {
      const ticket = await service.issueWalkInTicket();

      expect(ticket).toMatchObject({ ticketPrefix: 'B', ticketNumber: 1, status: 'waiting', appointmentId: null });
      expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(QUEUE_TICKET_EVENT.ISSUED, expect.objectContaining({ ticketLabel: 'B001', waitingCount: 3 }));
    });

    it('UTCID02 [N]: next number = current max + 1 for the same prefix/day', async () => {
      prisma.queueTicket.aggregate.mockResolvedValue({ _max: { ticketNumber: 7 } });

      const ticket = await service.issueWalkInTicket();

      expect(ticket.ticketNumber).toBe(8);
      expect(prisma.queueTicket.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ticketPrefix: 'B' }) }));
    });

    it('UTCID03 [B]: unique-constraint clash (P2002) is retried once with a fresh number', async () => {
      prisma.queueTicket.aggregate.mockResolvedValueOnce({ _max: { ticketNumber: 4 } }).mockResolvedValueOnce({ _max: { ticketNumber: 5 } });
      prisma.queueTicket.create.mockRejectedValueOnce(p2002());

      const ticket = await service.issueWalkInTicket();

      expect(prisma.queueTicket.create).toHaveBeenCalledTimes(2);
      expect(ticket.ticketNumber).toBe(6);
    });

    it('UTCID04 [A]: second consecutive P2002 is rethrown (no endless retry)', async () => {
      prisma.queueTicket.create.mockRejectedValue(p2002());

      await expect(service.issueWalkInTicket()).rejects.toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      expect(prisma.queueTicket.create).toHaveBeenCalledTimes(2);
    });

    it('UTCID05 [A]: non-unique DB error is rethrown immediately', async () => {
      prisma.queueTicket.create.mockRejectedValue(new Error('db down'));

      await expect(service.issueWalkInTicket()).rejects.toThrow('db down');
      expect(prisma.queueTicket.create).toHaveBeenCalledTimes(1);
    });

    it('UTCID06 [A]: realtime-event failure never breaks ticket issuing', async () => {
      prisma.queueTicket.count.mockRejectedValue(new Error('count failed'));

      await expect(service.issueWalkInTicket()).resolves.toMatchObject({ ticketPrefix: 'B' });
    });
  });

  // ---------------------------------------------------------------- issueTicketForAppointment (A)
  describe('issueTicketForAppointment', () => {
    it('UTCID01 [N]: online check-in ticket uses prefix A, is linked to the appointment and numbered independently from B', async () => {
      prisma.queueTicket.aggregate.mockResolvedValue({ _max: { ticketNumber: 2 } });

      const ticket = await service.issueTicketForAppointment(prisma, { appointmentId: 'apt-01' } as any, 'A' as any);

      expect(ticket).toMatchObject({ ticketPrefix: 'A', ticketNumber: 3, appointmentId: 'apt-01', status: 'waiting' });
      expect(prisma.queueTicket.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ticketPrefix: 'A' }) }));
    });
  });

  // ---------------------------------------------------------------- call
  describe('call', () => {
    it('UTCID01 [N]: waiting -> called with counter number, CALLED event emitted', async () => {
      prisma.queueTicket.findUnique.mockResolvedValue({ ticketId: 't-1', status: 'waiting', appointment: null });
      prisma.queueTicket.update.mockResolvedValue({
        ticketId: 't-1', ticketPrefix: 'B', ticketNumber: 1, status: 'called', counterNumber: 'Quầy 1', ticketDate: new Date('2026-11-20'), calledAt: new Date(),
      });

      const result = await service.call('t-1', { counterNumber: 'Quầy 1' } as any);

      expect(result.status).toBe('called');
      expect(eventEmitter.emit).toHaveBeenCalledWith(QUEUE_TICKET_EVENT.CALLED, expect.objectContaining({ counterNumber: 'Quầy 1' }));
    });

    it('UTCID02 [A]: only waiting tickets can be called', async () => {
      prisma.queueTicket.findUnique.mockResolvedValue({ ticketId: 't-1', status: 'done', appointment: null });

      await expect(service.call('t-1', { counterNumber: 'Quầy 1' } as any)).rejects.toThrow(BadRequestException);
      expect(prisma.queueTicket.update).not.toHaveBeenCalled();
    });

    it('UTCID03 [A]: unknown ticket -> NotFoundException', async () => {
      prisma.queueTicket.findUnique.mockResolvedValue(null);

      await expect(service.call('nope', {} as any)).rejects.toThrow(NotFoundException);
    });

    it('UTCID04 [N]: notification failure does not break calling a ticket of an online patient', async () => {
      prisma.queueTicket.findUnique.mockResolvedValue({
        ticketId: 't-1', status: 'waiting', appointment: { patient: { patientId: 'pat-1', userId: 'u-1' } },
      });
      prisma.queueTicket.update.mockResolvedValue({
        ticketId: 't-1', ticketPrefix: 'A', ticketNumber: 1, status: 'called', counterNumber: null, ticketDate: new Date('2026-11-20'), calledAt: new Date(),
      });
      notificationService.enqueue.mockRejectedValue(new Error('smtp down'));

      await expect(service.call('t-1', {} as any)).resolves.toMatchObject({ status: 'called' });
    });
  });

  // ---------------------------------------------------------------- done
  describe('done', () => {
    const receptionist: any = { userId: 'recep-01', permissions: [] };
    const calledWalkIn = { ticketId: 't-1', status: 'called', counterNumber: 'Quầy 1', appointment: null };

    it('UTCID01 [A]: only a called ticket can be completed', async () => {
      prisma.queueTicket.findUnique.mockResolvedValue({ ...calledWalkIn, status: 'waiting' });

      await expect(service.done('t-1', { doctorId: 'doc-01', patientId: 'p' } as any, receptionist)).rejects.toThrow(BadRequestException);
    });

    it('UTCID02 [A]: walk-in ticket without patient info -> BadRequestException', async () => {
      prisma.queueTicket.findUnique.mockResolvedValue(calledWalkIn);

      await expect(service.done('t-1', { doctorId: 'doc-01' } as any, receptionist)).rejects.toThrow(BadRequestException);
    });

    it('UTCID03 [A]: walk-in with BOTH patientId and patient is ambiguous -> BadRequestException', async () => {
      prisma.queueTicket.findUnique.mockResolvedValue(calledWalkIn);

      await expect(service.done('t-1', { doctorId: 'doc-01', patientId: 'p', patient: {} } as any, receptionist)).rejects.toThrow(BadRequestException);
    });

    it('UTCID04 [A]: online appointment with unresolved patient (patientId null) must be synced first', async () => {
      prisma.queueTicket.findUnique.mockResolvedValue({
        ...calledWalkIn,
        appointment: { appointmentId: 'apt-01', patientId: null, doctorId: 'doc-01', status: 'confirmed' },
      });

      await expect(service.done('t-1', {} as any, receptionist)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('UTCID05 [A]: doctor not on an active shift right now -> BadRequestException (DS-02 step 5 precondition)', async () => {
      prisma.queueTicket.findUnique.mockResolvedValue(calledWalkIn);
      prisma.doctor.findUnique.mockResolvedValue({ doctorId: 'doc-01' });
      prisma.doctorSchedule.findMany.mockResolvedValue([]);

      await expect(service.done('t-1', { doctorId: 'doc-01', patientId: 'p' } as any, receptionist)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('UTCID06 [A]: unknown doctor -> NotFoundException', async () => {
      prisma.queueTicket.findUnique.mockResolvedValue(calledWalkIn);
      prisma.doctor.findUnique.mockResolvedValue(null);

      await expect(service.done('t-1', { doctorId: 'ghost', patientId: 'p' } as any, receptionist)).rejects.toThrow(NotFoundException);
    });

    describe('with the doctor on shift', () => {
      beforeEach(() => {
        // 03:00Z = 10:00 giờ bệnh viện (UTC+7); ca 07:30-11:30 (giờ lưu dạng UTC-time trong cột @db.Time)
        jest.useFakeTimers({ now: new Date('2026-11-20T03:00:00.000Z') });
        prisma.doctor.findUnique.mockResolvedValue({ doctorId: 'doc-01' });
        prisma.doctorSchedule.findMany.mockResolvedValue([
          { startTime: new Date('1970-01-01T07:30:00.000Z'), endTime: new Date('1970-01-01T11:30:00.000Z') },
        ]);
        prisma.queueTicket.update.mockImplementation(async ({ data }: any) => ({ ticketId: 't-1', ticketPrefix: 'B', ticketNumber: 1, ticketDate: new Date('2026-11-20'), calledAt: null, counterNumber: 'Quầy 1', ...data }));
        prisma.appointment.create.mockImplementation(async ({ data }: any) => ({ appointmentId: 'apt-new', ...data }));
        prisma.appointment.update.mockImplementation(async ({ data }: any) => ({ appointmentId: 'apt-new', ...data }));
      });

      it('UTCID07 [N]: walk-in -> draft patient + walk_in appointment, ticket done, ReceptionCheckin, appointment confirmed, invoice pending', async () => {
        prisma.queueTicket.findUnique.mockResolvedValue(calledWalkIn);
        patientService.createDraftPatientRecord.mockResolvedValue({ patientId: 'pat-new' });
        invoiceService.generate.mockResolvedValue({ invoiceId: 'inv-1', status: 'pending' });

        const result = await service.done('t-1', { doctorId: 'doc-01', patient: { fullName: 'Anh Nguyen Nguyen' }, reasonForVisit: 'Đau ngực' } as any, receptionist);

        expect(patientService.createDraftPatientRecord).toHaveBeenCalledWith({ fullName: 'Anh Nguyen Nguyen' }, prisma);
        expect(prisma.appointment.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ bookingChannel: 'walk_in', status: 'pending', patientId: 'pat-new', doctorId: 'doc-01', slotId: null, bookedByUserId: 'recep-01' }),
        });
        expect(prisma.queueTicket.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'done', appointmentId: 'apt-new' } }));
        expect(prisma.receptionCheckin.create).toHaveBeenCalledWith({
          data: { appointmentId: 'apt-new', receptionStaffUserId: 'recep-01', counterNumber: 'Quầy 1' },
        });
        expect(result.appointment.status).toBe('confirmed');
        expect(invoiceService.generate).toHaveBeenCalledWith({ appointmentId: 'apt-new' });
        expect(result.invoice).toMatchObject({ status: 'pending' });
      });

      it('UTCID08 [N]: online ticket keeps the pre-selected doctor and reuses its appointment (no new appointment)', async () => {
        prisma.queueTicket.findUnique.mockResolvedValue({
          ...calledWalkIn,
          appointment: { appointmentId: 'apt-01', patientId: 'pat-1', doctorId: 'doc-01', status: 'pending' },
        });
        invoiceService.generate.mockResolvedValue({ invoiceId: 'inv-1', status: 'pending' });

        const result = await service.done('t-1', { doctorId: 'doc-OTHER' } as any, receptionist);

        expect(prisma.appointment.create).not.toHaveBeenCalled();
        expect(prisma.appointment.update).toHaveBeenCalledWith({ where: { appointmentId: 'apt-01' }, data: { doctorId: 'doc-01', status: 'confirmed' } });
        expect(result.queueTicket.status).toBe('done');
      });

      it('UTCID09 [A]: two receptionists pressing done at once -> loser gets BadRequestException (P2025 mapped)', async () => {
        prisma.queueTicket.findUnique.mockResolvedValue(calledWalkIn);
        patientService.createDraftPatientRecord.mockResolvedValue({ patientId: 'pat-new' });
        prisma.queueTicket.update.mockRejectedValue(p2025());

        await expect(service.done('t-1', { doctorId: 'doc-01', patient: {} } as any, receptionist)).rejects.toThrow(BadRequestException);
        expect(prisma.receptionCheckin.create).not.toHaveBeenCalled();
      });

      it('UTCID10 [N]: invoice generation failure is swallowed, falls back to the latest existing invoice', async () => {
        prisma.queueTicket.findUnique.mockResolvedValue(calledWalkIn);
        patientService.createDraftPatientRecord.mockResolvedValue({ patientId: 'pat-new' });
        invoiceService.generate.mockRejectedValue(new Error('fee not configured'));
        prisma.invoice.findFirst.mockResolvedValue(null);

        const result = await service.done('t-1', { doctorId: 'doc-01', patient: {} } as any, receptionist);

        expect(result.invoice).toBeNull();
        expect(result.appointment.status).toBe('confirmed');
      });

      it('UTCID11 [B]: shift ends exactly at "now" is still on shift; one minute later is not', async () => {
        jest.setSystemTime(new Date('2026-11-20T04:30:00.000Z')); // 11:30 HCM = endTime
        prisma.queueTicket.findUnique.mockResolvedValue(calledWalkIn);
        patientService.createDraftPatientRecord.mockResolvedValue({ patientId: 'pat-new' });
        invoiceService.generate.mockResolvedValue({});
        await expect(service.done('t-1', { doctorId: 'doc-01', patient: {} } as any, receptionist)).resolves.toBeDefined();

        jest.setSystemTime(new Date('2026-11-20T04:31:00.000Z')); // 11:31 HCM
        await expect(service.done('t-1', { doctorId: 'doc-01', patient: {} } as any, receptionist)).rejects.toThrow(BadRequestException);
      });
    });
  });
});

describe('compareQueueTickets (F-04: online ticket is called before walk-in)', () => {
  const t = (prefix: 'A' | 'B', n: number, priority?: string): any => ({
    ticketPrefix: prefix,
    ticketNumber: n,
    appointment: priority ? { priority } : null,
  });
  const order = (list: any[]) => [...list].sort(compareQueueTickets).map((x) => `${x.ticketPrefix}${x.ticketNumber}`);

  it('UTCID01 [N]: A (online) is listed before B (walk-in) even if B was issued first', () => {
    expect(order([t('B', 1), t('A', 5)])).toEqual(['A5', 'B1']);
  });

  it('UTCID02 [N]: same prefix and priority -> FIFO by ticket number', () => {
    expect(order([t('B', 3), t('B', 1), t('B', 2)])).toEqual(['B1', 'B2', 'B3']);
  });

  it('UTCID03 [N]: urgent jumps ahead only inside its own prefix', () => {
    expect(order([t('A', 1, 'normal'), t('A', 2, 'urgent'), t('B', 1, 'urgent')])).toEqual(['A2', 'A1', 'B1']);
  });

  it('UTCID04 [N]: emergency beats everything, even a normal ticket of the other prefix', () => {
    expect(order([t('A', 1, 'normal'), t('B', 9, 'emergency')])).toEqual(['B9', 'A1']);
  });

  it('UTCID05 [B]: two emergencies are served FIFO regardless of prefix', () => {
    expect(order([t('B', 2, 'emergency'), t('A', 5, 'emergency')])).toEqual(['B2', 'A5']);
  });

  it('UTCID06 [B]: walk-in ticket without appointment is treated as normal priority', () => {
    expect(order([t('B', 1), t('B', 2, 'urgent')])).toEqual(['B2', 'B1']);
  });
});
