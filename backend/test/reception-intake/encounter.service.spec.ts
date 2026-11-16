import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EncounterService } from '../../src/modules/patient-flow/reception-intake/encounter/encounter.service';

const p2025 = () => new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: 'test' } as any);

describe('EncounterService (F-04: encounter is created only after paid fee)', () => {
  let service: EncounterService;
  let prisma: any;
  let consentService: any;
  let triageQueueService: any;

  beforeEach(() => {
    prisma = {
      appointment: { findUnique: jest.fn(), update: jest.fn() },
      encounter: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      invoice: { findFirst: jest.fn(), updateMany: jest.fn() },
      patient: { updateMany: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    consentService = { hasActivePolicyConsent: jest.fn().mockResolvedValue(true) };
    triageQueueService = { enqueue: jest.fn() };
    service = new EncounterService(prisma, consentService, triageQueueService);
  });

  // ---------------------------------------------------------------- createAfterPaidConsultation
  describe('createAfterPaidConsultation', () => {
    const checkin = { checkinTime: new Date('2026-11-20T03:00:00.000Z') };
    const confirmedAppt = (over: Record<string, any> = {}) => ({
      appointmentId: 'apt-01',
      patientId: 'pat-01',
      doctorId: 'doc-01',
      status: 'confirmed',
      encounter: null,
      receptionCheckins: [checkin],
      ...over,
    });

    beforeEach(() => {
      prisma.invoice.findFirst.mockResolvedValue({ invoiceId: 'inv-1' });
      prisma.appointment.update.mockImplementation(async ({ data }: any) => ({ ...confirmedAppt(), ...data }));
      prisma.encounter.create.mockImplementation(async ({ data }: any) => ({ encounterId: 'enc-01', ...data }));
    });

    it('UTCID01 [N]: paid fee -> appointment checked_in, Encounter arrived, invoice linked to the encounter', async () => {
      prisma.appointment.findUnique.mockResolvedValue(confirmedAppt());

      const encounter = await service.createAfterPaidConsultation('apt-01');

      expect(prisma.appointment.update).toHaveBeenCalledWith({ where: { appointmentId: 'apt-01', status: 'confirmed' }, data: { status: 'checked_in' } });
      expect(encounter).toMatchObject({
        appointmentId: 'apt-01', patientId: 'pat-01', doctorId: 'doc-01', status: 'arrived', patientType: 'new', arrivedAt: checkin.checkinTime,
      });
      expect(encounter.encounterCode).toMatch(/^LK/);
      expect(prisma.invoice.updateMany).toHaveBeenCalledWith({
        where: { appointmentId: 'apt-01', encounterId: null },
        data: { encounterId: 'enc-01' },
      });
    });

    it('UTCID02 [N]: patient with a previously finished encounter is flagged "returning"', async () => {
      prisma.appointment.findUnique.mockResolvedValue(confirmedAppt());
      prisma.encounter.count.mockResolvedValue(2);

      const encounter = await service.createAfterPaidConsultation('apt-01');

      expect(encounter.patientType).toBe('returning');
    });

    it('UTCID03 [N]: idempotent - appointment that already has an encounter returns it without a transaction', async () => {
      prisma.appointment.findUnique.mockResolvedValue(confirmedAppt({ encounter: { encounterId: 'enc-old' } }));

      await expect(service.createAfterPaidConsultation('apt-01')).resolves.toEqual({ encounterId: 'enc-old' });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('UTCID04 [A]: FEE NOT PAID -> BadRequestException, no encounter, appointment untouched (DS-02 step 3)', async () => {
      prisma.appointment.findUnique.mockResolvedValue(confirmedAppt());
      prisma.invoice.findFirst.mockResolvedValue(null);

      await expect(service.createAfterPaidConsultation('apt-01')).rejects.toThrow('chưa thanh toán phí khám');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.encounter.create).not.toHaveBeenCalled();
    });

    it('UTCID05 [A]: only a PAID invoice that contains an examination-fee item counts', async () => {
      prisma.appointment.findUnique.mockResolvedValue(confirmedAppt());
      prisma.invoice.findFirst.mockResolvedValue(null);

      await expect(service.createAfterPaidConsultation('apt-01')).rejects.toThrow(BadRequestException);
      expect(prisma.invoice.findFirst).toHaveBeenCalledWith({
        where: { appointmentId: 'apt-01', status: 'paid', items: { some: { examinationFeeId: { not: null } } } },
        select: { invoiceId: true },
      });
    });

    it('UTCID06 [A]: unknown appointment -> NotFoundException', async () => {
      prisma.appointment.findUnique.mockResolvedValue(null);

      await expect(service.createAfterPaidConsultation('nope')).rejects.toThrow(NotFoundException);
    });

    it('UTCID07 [A]: appointment without a resolved patient -> BadRequestException', async () => {
      prisma.appointment.findUnique.mockResolvedValue(confirmedAppt({ patientId: null }));

      await expect(service.createAfterPaidConsultation('apt-01')).rejects.toThrow(BadRequestException);
    });

    it('UTCID08 [A]: appointment not in confirmed status -> BadRequestException', async () => {
      prisma.appointment.findUnique.mockResolvedValue(confirmedAppt({ status: 'pending' }));

      await expect(service.createAfterPaidConsultation('apt-01')).rejects.toThrow(BadRequestException);
    });

    it('UTCID09 [A]: no ReceptionCheckin yet (ticket not served at the counter) -> BadRequestException', async () => {
      prisma.appointment.findUnique.mockResolvedValue(confirmedAppt({ receptionCheckins: [] }));

      await expect(service.createAfterPaidConsultation('apt-01')).rejects.toThrow(BadRequestException);
      expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- completeRegistration
  describe('completeRegistration', () => {
    const user: any = { userId: 'recep-01' };
    const arrivedEncounter = (over: Record<string, any> = {}) => ({
      encounterId: 'enc-01',
      appointmentId: 'apt-01',
      patientId: 'pat-01',
      status: 'arrived',
      chiefComplaint: { id: 'cc-1' },
      identityVerifications: [{ id: 'iv-1' }],
      patient: { identityVerified: false },
      ...over,
    });

    beforeEach(() => {
      prisma.encounter.findUnique.mockResolvedValue(arrivedEncounter());
      prisma.invoice.findFirst.mockResolvedValue({ invoiceId: 'inv-1' });
      prisma.appointment.findUnique.mockResolvedValue({ priority: 'normal' });
      prisma.encounter.update.mockImplementation(async ({ data }: any) => ({ encounterId: 'enc-01', patientId: 'pat-01', ...data }));
      triageQueueService.enqueue.mockResolvedValue({ queueEntryId: 'q-1', status: 'waiting' });
    });

    it('UTCID01 [N]: everything complete -> encounter registered, patient draft->main, patient enters triage queue (waiting)', async () => {
      const result = await service.completeRegistration('enc-01', user);

      expect(result.encounter.status).toBe('registered');
      expect(prisma.patient.updateMany).toHaveBeenCalledWith({ where: { patientId: 'pat-01', status: 'draft' }, data: { status: 'main' } });
      expect(triageQueueService.enqueue).toHaveBeenCalledWith(prisma, expect.objectContaining({ status: 'registered' }), 'normal');
      expect(result.triageQueueEntry).toMatchObject({ status: 'waiting' });
    });

    it('UTCID02 [N]: patient already identity-verified in a previous visit does not need a new verification', async () => {
      prisma.encounter.findUnique.mockResolvedValue(arrivedEncounter({ identityVerifications: [], patient: { identityVerified: true } }));

      await expect(service.completeRegistration('enc-01', user)).resolves.toBeDefined();
    });

    it('UTCID03 [A]: missing items are ALL reported at once (chief complaint, ID check, 2 consents) and nothing changes (DS-02 step 4)', async () => {
      prisma.encounter.findUnique.mockResolvedValue(arrivedEncounter({ chiefComplaint: null, identityVerifications: [] }));
      consentService.hasActivePolicyConsent.mockResolvedValue(false);

      const error: any = await service.completeRegistration('enc-01', user).catch((e) => e);

      expect(error).toBeInstanceOf(BadRequestException);
      const missing: string[] = error.getResponse().missing;
      expect(missing).toHaveLength(4);
      expect(missing.join(' | ')).toContain('chief complaint');
      expect(missing.join(' | ')).toContain('danh tính');
      expect(missing.join(' | ')).toContain('data_processing');
      expect(missing.join(' | ')).toContain('treatment_consent');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.patient.updateMany).not.toHaveBeenCalled();
    });

    it('UTCID04 [A]: unpaid consultation fee is reported as missing', async () => {
      prisma.invoice.findFirst.mockResolvedValue(null);

      const error: any = await service.completeRegistration('enc-01', user).catch((e) => e);

      expect(error.getResponse().missing).toEqual(['Bệnh nhân chưa thanh toán phí khám']);
    });

    it('UTCID05 [A]: second call on an already registered encounter is rejected, no duplicate triage entry', async () => {
      prisma.encounter.findUnique.mockResolvedValue(arrivedEncounter({ status: 'registered' }));

      await expect(service.completeRegistration('enc-01', user)).rejects.toThrow(BadRequestException);
      expect(triageQueueService.enqueue).not.toHaveBeenCalled();
    });

    it('UTCID06 [A]: unknown encounter -> NotFoundException', async () => {
      prisma.encounter.findUnique.mockResolvedValue(null);

      await expect(service.completeRegistration('nope', user)).rejects.toThrow(NotFoundException);
    });

    it('UTCID07 [A]: concurrent completion (CAS fails with P2025) -> BadRequestException, no enqueue', async () => {
      prisma.encounter.update.mockRejectedValue(p2025());

      await expect(service.completeRegistration('enc-01', user)).rejects.toThrow(BadRequestException);
      expect(triageQueueService.enqueue).not.toHaveBeenCalled();
    });

    it('UTCID08 [B]: only ONE mandatory consent signed -> still blocked and reports exactly one missing item', async () => {
      consentService.hasActivePolicyConsent.mockImplementation(async (_p: string, type: string) => type === 'data_processing');

      const error: any = await service.completeRegistration('enc-01', user).catch((e) => e);

      expect(error.getResponse().missing).toHaveLength(1);
      expect(error.getResponse().missing[0]).toContain('treatment_consent');
    });
  });
});
