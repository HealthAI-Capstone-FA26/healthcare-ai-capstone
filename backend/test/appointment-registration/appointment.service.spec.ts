import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AppointmentService } from '../../src/modules/patient-flow/appointment-registration/appointment/appointment.service';
import { getHospitalWallClockNow } from '../../src/common/utils/hospital-clock.util';

const FUTURE = new Date('2099-01-01T08:00:00.000Z');
const PAST = new Date('2000-01-01T08:00:00.000Z');

const makeSlot = (over: Record<string, any> = {}) => ({
  slotId: 'slot-01',
  status: 'free',
  capacity: 1,
  bookedCount: 0,
  slotStartTime: FUTURE,
  schedule: { doctorId: 'doc-01' },
  ...over,
});

describe('AppointmentService (F-03 Book appointment / F-04 check-in)', () => {
  let service: AppointmentService;
  let prisma: any;
  let patientService: any;
  let queueTicketService: any;

  beforeEach(() => {
    prisma = {
      patient: { findUnique: jest.fn(), findMany: jest.fn() },
      appointmentSlot: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
      appointment: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      queueTicket: { findUnique: jest.fn() },
      user: { findFirst: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    patientService = {};
    queueTicketService = { issueTicketForAppointment: jest.fn() };
    service = new AppointmentService(prisma, patientService, queueTicketService);
  });

  afterEach(() => jest.useRealTimers());

  // ---------------------------------------------------------------- createOnline
  describe('createOnline', () => {
    const dto: any = { patientId: 'pat-01', doctorId: 'doc-01', slotId: 'slot-01', reasonForVisit: 'Đau ngực' };
    const user: any = { userId: 'user-01', permissions: [] };

    beforeEach(() => {
      prisma.patient.findUnique.mockResolvedValue({ patientId: 'pat-01', userId: 'user-01' });
      prisma.appointment.create.mockImplementation(async ({ data }: any) => ({ appointmentId: 'apt-01', ...data }));
      prisma.appointmentSlot.updateMany.mockResolvedValue({ count: 1 });
    });

    it('UTCID01 [N]: books a free slot -> appointment pending/online, bookedCount +1, slot stays free while capacity remains', async () => {
      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ capacity: 2, bookedCount: 0 }));

      const result = await service.createOnline(dto, user);

      expect(result).toMatchObject({ status: 'pending', bookingChannel: 'online', patientId: 'pat-01', bookedByUserId: 'user-01' });
      expect(prisma.appointmentSlot.updateMany).toHaveBeenCalledWith({
        where: { slotId: 'slot-01', bookedCount: { lt: 2 } },
        data: { bookedCount: { increment: 1 } },
      });
      expect(prisma.appointmentSlot.update).not.toHaveBeenCalled();
    });

    it('UTCID02 [B]: booking the last seat flips slot free -> full', async () => {
      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ capacity: 1, bookedCount: 0 }));

      await service.createOnline(dto, user);

      expect(prisma.appointmentSlot.update).toHaveBeenCalledWith({ where: { slotId: 'slot-01' }, data: { status: 'full' } });
    });

    it('UTCID03 [A]: throws NotFoundException when patient profile does not exist', async () => {
      prisma.patient.findUnique.mockResolvedValue(null);

      await expect(service.createOnline(dto, user)).rejects.toThrow(NotFoundException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('UTCID04 [A]: throws ForbiddenException when patient profile is not linked to the current account', async () => {
      prisma.patient.findUnique.mockResolvedValue({ patientId: 'pat-01', userId: 'someone-else' });

      await expect(service.createOnline(dto, user)).rejects.toThrow(ForbiddenException);
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });

    it('UTCID05 [A]: a full slot cannot be selected -> BadRequestException, nothing created', async () => {
      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ status: 'full', bookedCount: 1 }));

      await expect(service.createOnline(dto, user)).rejects.toThrow(BadRequestException);
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });

    it('UTCID06 [A]: slot belonging to another doctor is rejected', async () => {
      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ schedule: { doctorId: 'doc-99' } }));

      await expect(service.createOnline(dto, user)).rejects.toThrow(BadRequestException);
    });

    it('UTCID07 [A]: race condition - slot filled between check and update -> ConflictException', async () => {
      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot());
      prisma.appointmentSlot.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.createOnline(dto, user)).rejects.toThrow(ConflictException);
    });

    it('UTCID08 [A]: slot that already started in the past is rejected', async () => {
      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ slotStartTime: PAST }));

      await expect(service.createOnline(dto, user)).rejects.toThrow(BadRequestException);
    });

    it('UTCID09 [B]: slotStartTime exactly equal to "now" is rejected, one second later is accepted', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-20T03:00:00.000Z') });
      const now = getHospitalWallClockNow();

      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ slotStartTime: now, capacity: 2 }));
      await expect(service.createOnline(dto, user)).rejects.toThrow(BadRequestException);

      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ slotStartTime: new Date(now.getTime() + 1000), capacity: 2 }));
      await expect(service.createOnline(dto, user)).resolves.toMatchObject({ status: 'pending' });
    });
  });

  // ---------------------------------------------------------------- confirm
  describe('confirm', () => {
    it('UTCID01 [N]: pending -> confirmed when at least one active nurse exists', async () => {
      prisma.appointment.findUnique.mockResolvedValue({ appointmentId: 'apt-01', status: 'pending' });
      prisma.user.findFirst.mockResolvedValue({ userId: 'nurse-01' });
      prisma.appointment.update.mockResolvedValue({ appointmentId: 'apt-01', status: 'confirmed' });

      const result = await service.confirm('apt-01');

      expect(result.status).toBe('confirmed');
      expect(prisma.appointment.update).toHaveBeenCalledWith({ where: { appointmentId: 'apt-01' }, data: { status: 'confirmed' } });
    });

    it('UTCID02 [A]: blocked when no active nurse exists', async () => {
      prisma.appointment.findUnique.mockResolvedValue({ appointmentId: 'apt-01', status: 'pending' });
      prisma.user.findFirst.mockResolvedValue(null);

      await expect(service.confirm('apt-01')).rejects.toThrow(BadRequestException);
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });

    it('UTCID03 [A]: invalid transition checked_in -> confirmed is rejected', async () => {
      prisma.appointment.findUnique.mockResolvedValue({ appointmentId: 'apt-01', status: 'checked_in' });
      prisma.user.findFirst.mockResolvedValue({ userId: 'nurse-01' });

      await expect(service.confirm('apt-01')).rejects.toThrow(BadRequestException);
    });

    it('UTCID04 [A]: unknown appointment -> NotFoundException', async () => {
      prisma.appointment.findUnique.mockResolvedValue(null);

      await expect(service.confirm('nope')).rejects.toThrow(NotFoundException);
    });
  });

  // ---------------------------------------------------------------- checkIn (ticket A)
  describe('checkIn', () => {
    const onlineConfirmed = { appointmentId: 'apt-01', bookingChannel: 'online', status: 'confirmed' };

    it('UTCID01 [N]: confirmed online appointment gets a ticket with prefix A (status stays confirmed)', async () => {
      prisma.appointment.findUnique.mockResolvedValue(onlineConfirmed);
      prisma.queueTicket.findUnique.mockResolvedValue(null);
      queueTicketService.issueTicketForAppointment.mockResolvedValue({ ticketPrefix: 'A', ticketNumber: 1, status: 'waiting' });

      const result = await service.checkIn('apt-01');

      expect(queueTicketService.issueTicketForAppointment).toHaveBeenCalledWith(prisma, onlineConfirmed, 'A');
      expect(result.queueTicket).toMatchObject({ ticketPrefix: 'A', status: 'waiting' });
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });

    it('UTCID02 [A]: walk_in appointments cannot use check-in', async () => {
      prisma.appointment.findUnique.mockResolvedValue({ ...onlineConfirmed, bookingChannel: 'walk_in' });

      await expect(service.checkIn('apt-01')).rejects.toThrow(BadRequestException);
      expect(queueTicketService.issueTicketForAppointment).not.toHaveBeenCalled();
    });

    it('UTCID03 [A]: appointment not yet confirmed cannot check in', async () => {
      prisma.appointment.findUnique.mockResolvedValue({ ...onlineConfirmed, status: 'pending' });

      await expect(service.checkIn('apt-01')).rejects.toThrow(BadRequestException);
    });

    it('UTCID04 [A]: second check-in is rejected when a ticket already exists', async () => {
      prisma.appointment.findUnique.mockResolvedValue(onlineConfirmed);
      prisma.queueTicket.findUnique.mockResolvedValue({ ticketId: 't-1' });

      await expect(service.checkIn('apt-01')).rejects.toThrow(BadRequestException);
      expect(queueTicketService.issueTicketForAppointment).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- cancel
  describe('cancel', () => {
    const appt = { appointmentId: 'apt-01', status: 'confirmed', slotId: 'slot-01', bookedByUserId: 'user-01' };

    it('UTCID01 [N]: owner cancels -> status cancelled, slot bookedCount -1 and reopened (free)', async () => {
      prisma.appointment.findUnique.mockResolvedValue(appt);
      prisma.appointment.update.mockResolvedValue({ ...appt, status: 'cancelled' });

      const result = await service.cancel('apt-01', { cancelReason: 'Bận' } as any, { userId: 'user-01', permissions: [] } as any);

      expect(result.status).toBe('cancelled');
      expect(prisma.appointmentSlot.update).toHaveBeenCalledWith({
        where: { slotId: 'slot-01' },
        data: { bookedCount: { decrement: 1 }, status: 'free' },
      });
    });

    it('UTCID02 [N]: staff with appointment:update:all can cancel any appointment', async () => {
      prisma.appointment.findUnique.mockResolvedValue(appt);
      prisma.appointment.update.mockResolvedValue({ ...appt, status: 'cancelled' });

      await expect(
        service.cancel('apt-01', { cancelReason: 'x' } as any, { userId: 'staff', permissions: ['appointment:update:all'] } as any),
      ).resolves.toMatchObject({ status: 'cancelled' });
    });

    it('UTCID03 [A]: a patient cannot cancel an appointment booked by someone else', async () => {
      prisma.appointment.findUnique.mockResolvedValue(appt);

      await expect(
        service.cancel('apt-01', { cancelReason: 'x' } as any, { userId: 'other', permissions: [] } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.appointment.update).not.toHaveBeenCalled();
    });

    it('UTCID04 [A]: checked_in appointment cannot be cancelled', async () => {
      prisma.appointment.findUnique.mockResolvedValue({ ...appt, status: 'checked_in' });

      await expect(
        service.cancel('apt-01', { cancelReason: 'x' } as any, { userId: 'user-01', permissions: [] } as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------- rescheduleFollowUp (F-14)
  describe('rescheduleFollowUp', () => {
    const followUp = {
      appointmentId: 'apt-01',
      appointmentType: 'follow_up',
      status: 'confirmed',
      doctorId: 'doc-01',
      slotId: 'slot-old',
      patient: { userId: 'user-01' },
    };
    const owner: any = { userId: 'user-01', permissions: [] };

    beforeEach(() => {
      prisma.appointment.findUnique.mockResolvedValue(followUp);
      prisma.appointmentSlot.updateMany.mockResolvedValue({ count: 1 });
      prisma.appointment.update.mockImplementation(async ({ data }: any) => ({ appointmentId: 'apt-01', ...data }));
    });

    it('UTCID01 [N]: owner moves follow-up to a new slot -> old slot released, new slot reserved', async () => {
      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ slotId: 'slot-new', capacity: 3 }));

      const result = await service.rescheduleFollowUp('apt-01', { slotId: 'slot-new' } as any, owner);

      expect(prisma.appointmentSlot.update).toHaveBeenCalledWith({
        where: { slotId: 'slot-old' },
        data: { bookedCount: { decrement: 1 }, status: 'free' },
      });
      expect(prisma.appointmentSlot.updateMany).toHaveBeenCalledWith({
        where: { slotId: 'slot-new', bookedCount: { lt: 3 } },
        data: { bookedCount: { increment: 1 } },
      });
      expect(result.slotId).toBe('slot-new');
    });

    it('UTCID02 [B]: taking the last seat of the new slot marks it full', async () => {
      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ slotId: 'slot-new', capacity: 1, bookedCount: 0 }));

      await service.rescheduleFollowUp('apt-01', { slotId: 'slot-new' } as any, owner);

      expect(prisma.appointmentSlot.update).toHaveBeenCalledWith({ where: { slotId: 'slot-new' }, data: { status: 'full' } });
    });

    it('UTCID03 [A]: only follow_up appointments can be rescheduled by the patient', async () => {
      prisma.appointment.findUnique.mockResolvedValue({ ...followUp, appointmentType: 'regular' });

      await expect(service.rescheduleFollowUp('apt-01', { slotId: 'slot-new' } as any, owner)).rejects.toThrow(BadRequestException);
    });

    it('UTCID04 [A]: a patient can reschedule only their own follow-up -> ForbiddenException', async () => {
      await expect(
        service.rescheduleFollowUp('apt-01', { slotId: 'slot-new' } as any, { userId: 'stranger', permissions: [] } as any),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('UTCID05 [A]: checked_in follow-up can no longer be rescheduled', async () => {
      prisma.appointment.findUnique.mockResolvedValue({ ...followUp, status: 'checked_in' });

      await expect(service.rescheduleFollowUp('apt-01', { slotId: 'slot-new' } as any, owner)).rejects.toThrow(BadRequestException);
    });

    it('UTCID06 [A]: neither slotId nor appointmentDate provided -> BadRequestException', async () => {
      await expect(service.rescheduleFollowUp('apt-01', {} as any, owner)).rejects.toThrow(BadRequestException);
    });

    it('UTCID07 [A]: new slot already full -> BadRequestException, old slot untouched', async () => {
      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ slotId: 'slot-new', status: 'full' }));

      await expect(service.rescheduleFollowUp('apt-01', { slotId: 'slot-new' } as any, owner)).rejects.toThrow(BadRequestException);
      expect(prisma.appointmentSlot.update).not.toHaveBeenCalled();
    });

    it('UTCID08 [A]: new slot of a different doctor is rejected', async () => {
      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ slotId: 'slot-new', schedule: { doctorId: 'doc-99' } }));

      await expect(service.rescheduleFollowUp('apt-01', { slotId: 'slot-new' } as any, owner)).rejects.toThrow(BadRequestException);
    });
  });
});
