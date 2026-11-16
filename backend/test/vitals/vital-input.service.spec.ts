import { BadRequestException, NotFoundException } from '@nestjs/common';
import { VitalInputService } from '../../src/modules/clinical/vitals/vital-input/vital-recording/vital-input.service';
import {
  VITAL_SESSION_CREATED_EVENT,
  VitalSessionCreatedEvent,
} from '../../src/modules/clinical/vitals/vital-anomaly/vital-session-created.event';

const ENC_ID = '11111111-1111-4111-8111-111111111111';
const PAT_ID = '22222222-2222-4222-8222-222222222222';
const NURSE_ID = '33333333-3333-4333-8333-333333333333';
const CODES = ['HR', 'SBP', 'DBP', 'TEMP', 'RR', 'SPO2', 'HEIGHT', 'WEIGHT', 'BMI'];
const catalog = CODES.map((c) => ({ itemId: `item-${c}`, itemCode: c, isActive: true }));

describe('VitalInputService (F-05 record vital signs)', () => {
  let service: VitalInputService;
  let prisma: any;
  let eventEmitter: any;
  let triageQueueService: any;

  beforeEach(() => {
    prisma = {
      encounter: { findFirst: jest.fn().mockResolvedValue({ encounterId: ENC_ID, patientId: PAT_ID }) },
      patient: { findFirst: jest.fn() },
      vitalSignItem: { findMany: jest.fn().mockResolvedValue(catalog) },
      vitalSignSession: {
        create: jest.fn(async ({ data }: any) => ({ vitalSessionId: 'vs-01', ...data })),
        findUnique: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ vitalSessionId: 'vs-01' }),
      },
      vitalSignObservation: { update: jest.fn(), create: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    eventEmitter = { emit: jest.fn() };
    triageQueueService = { complete: jest.fn() };
    service = new VitalInputService(prisma, eventEmitter, triageQueueService);
  });

  const observationsOf = (call: any) =>
    Object.fromEntries(call.data.observations.create.map((o: any) => [o.itemId.replace('item-', ''), o.observationValue]));

  // ---------------------------------------------------------------- recordVitalSigns
  describe('recordVitalSigns', () => {
    it('UTCID01 [N]: DS-01 vitals (165 cm / 58 kg) -> 9 observations incl. auto BMI = 21.30, then ONE vital-session.created event', async () => {
      const session = await service.recordVitalSigns({
        encounterId: ENC_ID, patientId: PAT_ID, recordedByUserId: NURSE_ID,
        pulse: 102, systolicBp: 120, diastolicBp: 92, temperature: 36.8, respiratoryRate: 16, spo2: 98, height: 165, weight: 58,
      } as any);

      const saved = observationsOf(prisma.vitalSignSession.create.mock.calls[0][0]);
      expect(Object.keys(saved)).toHaveLength(9);
      expect(saved.BMI).toBe(21.3);
      expect(saved).toMatchObject({ HR: 102, SBP: 120, DBP: 92, TEMP: 36.8, RR: 16, SPO2: 98, HEIGHT: 165, WEIGHT: 58 });
      expect(prisma.vitalSignSession.create.mock.calls[0][0].data).toMatchObject({ encounterId: ENC_ID, recordedByUserId: NURSE_ID });
      expect(eventEmitter.emit).toHaveBeenCalledTimes(1);
      expect(eventEmitter.emit).toHaveBeenCalledWith(VITAL_SESSION_CREATED_EVENT, new VitalSessionCreatedEvent(session.vitalSessionId));
    });

    it('UTCID02 [N]: BMI is rounded to 2 decimals (170 cm / 65 kg -> 22.49)', async () => {
      await service.recordVitalSigns({ encounterId: ENC_ID, patientId: PAT_ID, recordedByUserId: NURSE_ID, height: 170, weight: 65 } as any);

      expect(observationsOf(prisma.vitalSignSession.create.mock.calls[0][0]).BMI).toBe(22.49);
    });

    it('UTCID03 [N]: partial input (only pulse) is allowed and produces exactly one observation', async () => {
      await service.recordVitalSigns({ encounterId: ENC_ID, patientId: PAT_ID, recordedByUserId: NURSE_ID, pulse: 80 } as any);

      expect(Object.keys(observationsOf(prisma.vitalSignSession.create.mock.calls[0][0]))).toEqual(['HR']);
    });

    it('UTCID04 [B]: height WITHOUT weight (or vice versa) never produces a BMI observation', async () => {
      await service.recordVitalSigns({ encounterId: ENC_ID, patientId: PAT_ID, recordedByUserId: NURSE_ID, height: 170 } as any);
      await service.recordVitalSigns({ encounterId: ENC_ID, patientId: PAT_ID, recordedByUserId: NURSE_ID, weight: 60 } as any);

      for (const [arg] of prisma.vitalSignSession.create.mock.calls) {
        expect(observationsOf(arg).BMI).toBeUndefined();
      }
    });

    it('UTCID05 [N]: when recording from the triage queue (queueEntryId) the entry is completed in the SAME transaction', async () => {
      await service.recordVitalSigns({ encounterId: ENC_ID, patientId: PAT_ID, recordedByUserId: NURSE_ID, pulse: 80, queueEntryId: 'q-1' } as any);

      expect(triageQueueService.complete).toHaveBeenCalledWith(prisma, 'q-1', NURSE_ID, 'vs-01', ENC_ID);
    });

    it('UTCID06 [A]: no measurement at all -> BadRequestException, DB untouched, no event', async () => {
      await expect(service.recordVitalSigns({ encounterId: ENC_ID, patientId: PAT_ID, recordedByUserId: NURSE_ID } as any)).rejects.toThrow(BadRequestException);

      expect(prisma.encounter.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('UTCID07 [A]: vital-sign catalog missing a code -> BadRequestException naming the code', async () => {
      prisma.vitalSignItem.findMany.mockResolvedValue(catalog.filter((c) => c.itemCode !== 'SPO2'));

      await expect(
        service.recordVitalSigns({ encounterId: ENC_ID, patientId: PAT_ID, recordedByUserId: NURSE_ID, pulse: 80, spo2: 98 } as any),
      ).rejects.toThrow(/SPO2/);
      expect(prisma.vitalSignSession.create).not.toHaveBeenCalled();
    });

    it('UTCID08 [A]: failure while completing the triage entry rolls back and emits NO event (no alert for unsaved data)', async () => {
      triageQueueService.complete.mockRejectedValue(new BadRequestException('queue entry not waiting'));

      await expect(
        service.recordVitalSigns({ encounterId: ENC_ID, patientId: PAT_ID, recordedByUserId: NURSE_ID, pulse: 80, queueEntryId: 'q-1' } as any),
      ).rejects.toThrow(BadRequestException);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('UTCID09 [N]: encounter can be referenced by encounterCode; patientId is taken from the encounter', async () => {
      await service.recordVitalSigns({ encounterId: 'LK261120000001', patientId: 'ignored', recordedByUserId: NURSE_ID, pulse: 80 } as any);

      expect(prisma.encounter.findFirst).toHaveBeenCalledWith({ where: { OR: [{ encounterCode: 'LK261120000001' }] } });
      expect(prisma.vitalSignSession.create.mock.calls[0][0].data.encounterId).toBe(ENC_ID);
    });

    // Hành vi HIỆN TẠI là fallback sang UUID 0000... (gây lỗi FK 500). Khi sửa service để ném NotFound, bỏ .todo và viết test thật.
    it.todo('UTCID10 [A]: unknown encounter AND unknown patient -> NotFoundException (currently falls back to a zero-UUID and fails on FK)');
    it.todo('UTCID11 [A]: recordedByUserId must come from the JWT user, not the request body (controller-level, see e2e/vitals)');
  });

  // ---------------------------------------------------------------- updateVitalSigns
  describe('updateVitalSigns', () => {
    const existingSession = () => ({
      vitalSessionId: 'vs-01',
      observations: [
        { observationId: 'o-h', observationValue: 165, item: { itemCode: 'HEIGHT' } },
        { observationId: 'o-w', observationValue: 58, item: { itemCode: 'WEIGHT' } },
        { observationId: 'o-b', observationValue: 21.3, item: { itemCode: 'BMI' } },
        { observationId: 'o-hr', observationValue: 80, item: { itemCode: 'HR' } },
      ],
    });

    it('UTCID01 [N]: changing weight only recomputes BMI using the STORED height (165 cm / 70 kg -> 25.71) and re-emits the event', async () => {
      prisma.vitalSignSession.findUnique.mockResolvedValue(existingSession());

      await service.updateVitalSigns('vs-01', { weight: 70 } as any);

      expect(prisma.vitalSignObservation.update).toHaveBeenCalledWith({ where: { observationId: 'o-w' }, data: { observationValue: 70 } });
      expect(prisma.vitalSignObservation.update).toHaveBeenCalledWith({ where: { observationId: 'o-b' }, data: { observationValue: 25.71 } });
      expect(eventEmitter.emit).toHaveBeenCalledWith(VITAL_SESSION_CREATED_EVENT, new VitalSessionCreatedEvent('vs-01'));
    });

    it('UTCID02 [N]: adding a measurement that was not recorded before creates a new observation', async () => {
      prisma.vitalSignSession.findUnique.mockResolvedValue(existingSession());
      prisma.vitalSignItem.findMany.mockResolvedValue([{ itemId: 'item-SPO2', itemCode: 'SPO2' }]);

      await service.updateVitalSigns('vs-01', { spo2: 97 } as any);

      expect(prisma.vitalSignObservation.create).toHaveBeenCalledWith({ data: { vitalSessionId: 'vs-01', itemId: 'item-SPO2', observationValue: 97 } });
    });

    it('UTCID03 [N]: untouched fields stay as they were (only pulse updated)', async () => {
      prisma.vitalSignSession.findUnique.mockResolvedValue(existingSession());

      await service.updateVitalSigns('vs-01', { pulse: 110 } as any);

      expect(prisma.vitalSignObservation.update).toHaveBeenCalledTimes(1);
      expect(prisma.vitalSignObservation.update).toHaveBeenCalledWith({ where: { observationId: 'o-hr' }, data: { observationValue: 110 } });
    });

    it('UTCID04 [A]: unknown session -> NotFoundException', async () => {
      prisma.vitalSignSession.findUnique.mockResolvedValue(null);

      await expect(service.updateVitalSigns('nope', { pulse: 1 } as any)).rejects.toThrow(NotFoundException);
    });

    it('UTCID05 [A]: empty update -> BadRequestException, no event', async () => {
      prisma.vitalSignSession.findUnique.mockResolvedValue(existingSession());

      await expect(service.updateVitalSigns('vs-01', {} as any)).rejects.toThrow(BadRequestException);
      expect(eventEmitter.emit).not.toHaveBeenCalled();
    });

    it('UTCID06 [B]: updating only notes is a valid change and updates the session row', async () => {
      prisma.vitalSignSession.findUnique.mockResolvedValue(existingSession());

      await service.updateVitalSigns('vs-01', { notes: 'đo lại sau nghỉ 5 phút' } as any);

      expect(prisma.vitalSignSession.update).toHaveBeenCalledWith({ where: { vitalSessionId: 'vs-01' }, data: { notes: 'đo lại sau nghỉ 5 phút' } });
      expect(prisma.vitalSignObservation.update).not.toHaveBeenCalled();
    });
  });
});
