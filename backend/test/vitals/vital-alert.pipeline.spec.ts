import { RuleBasedDetector } from '../../src/modules/clinical/vitals/vital-anomaly/rule-based.detector';
import { VitalSignDetectionOrchestrator } from '../../src/modules/clinical/vitals/vital-anomaly/vital-sign-detection.orchestrator';
import { VitalSignDetectionListener } from '../../src/modules/clinical/vitals/vital-anomaly/vital-sign-detection.listener';
import { VitalAlertGateway } from '../../src/modules/clinical/vitals/vital-anomaly/vital-alert.gateway';
import { VitalSessionCreatedEvent } from '../../src/modules/clinical/vitals/vital-anomaly/vital-session-created.event';

// Ngưỡng người lớn 16-64 tuổi (khớp prisma/seeds/09-vital-sign-threshold.seed.ts)
const THRESHOLDS: Record<string, { min: number; max: number }> = {
  'item-HR': { min: 51, max: 90 },
  'item-SBP': { min: 111, max: 219 },
  'item-DBP': { min: 60, max: 79 },
  'item-TEMP': { min: 36.1, max: 37.2 },
  'item-RR': { min: 12, max: 20 },
  'item-SPO2': { min: 96, max: 100 },
};

const obs = (code: string, value: number, unit = '') => ({
  observationId: `o-${code}`,
  itemId: `item-${code}`,
  observationValue: value,
  item: { itemCode: code, itemName: code, unit },
});

const makeSession = (observations: any[], patient: any = { dateOfBirth: new Date(2005, 0, 1), gender: 'male' }) =>
  ({
    vitalSessionId: 'vs-01',
    measuredAt: new Date(2026, 10, 16, 10, 0, 0),
    observations,
    encounter: { patient },
  }) as any;

const fakePrismaWithThresholds = () =>
  ({
    vitalSignThreshold: {
      findMany: jest.fn(async ({ where }: any) => {
        const t = THRESHOLDS[where.itemId];
        return t
          ? [{ vitalThresholdId: `th-${where.itemId}`, minNormal: t.min, maxNormal: t.max, gender: null, ageMin: 16, ageMax: 64, sourceReference: 'seed' }]
          : [];
      }),
    },
  }) as any;

describe('RuleBasedDetector (F-05: out-of-range value is flagged)', () => {
  let detector: RuleBasedDetector;

  beforeEach(() => {
    detector = new RuleBasedDetector(fakePrismaWithThresholds());
  });

  const byCode = (results: any[]) => Object.fromEntries(results.map((r) => [r.observationId.replace('o-', ''), r]));

  it('UTCID01 [N]: DS-01 values -> exactly Pulse 102 and DBP 92 are abnormal/critical, everything else normal', async () => {
    const results = await detector.detect(
      makeSession([obs('HR', 102, 'bpm'), obs('SBP', 120), obs('DBP', 92), obs('TEMP', 36.8), obs('RR', 16), obs('SPO2', 98)]),
    );

    const r = byCode(results);
    expect(results.filter((x) => x.isAbnormal).map((x) => x.observationId).sort()).toEqual(['o-DBP', 'o-HR']);
    expect(r.HR).toMatchObject({ isAbnormal: true, alertLevel: 'critical', alertSource: 'rule', expectedMin: 51, expectedMax: 90, thresholdId: 'th-item-HR' });
    expect(r.HR.reason).toContain('bất thường');
    expect(r.SBP).toMatchObject({ isAbnormal: false, alertLevel: null });
  });

  it('UTCID02 [B]: HR 90 (upper bound) is normal, 91 is abnormal', async () => {
    const [at] = await detector.detect(makeSession([obs('HR', 90)]));
    const [over] = await detector.detect(makeSession([obs('HR', 91)]));

    expect(at.isAbnormal).toBe(false);
    expect(over.isAbnormal).toBe(true);
  });

  it('UTCID03 [B]: HR 51 (lower bound) is normal, 50 is abnormal (bradycardia)', async () => {
    const [at] = await detector.detect(makeSession([obs('HR', 51)]));
    const [under] = await detector.detect(makeSession([obs('HR', 50)]));

    expect(at.isAbnormal).toBe(false);
    expect(under.isAbnormal).toBe(true);
  });

  it('UTCID04 [N]: BMI / HEIGHT / WEIGHT have no threshold row -> never abnormal, never raise an alert', async () => {
    const results = await detector.detect(makeSession([obs('BMI', 40), obs('HEIGHT', 165), obs('WEIGHT', 58)]));

    expect(results.every((x) => x.isAbnormal === false && x.thresholdId === null && x.alertLevel === null)).toBe(true);
  });

  it('UTCID05 [A]: patient without date of birth -> detector throws (caller must handle, see listener tests)', async () => {
    await expect(detector.detect(makeSession([obs('HR', 80)], { dateOfBirth: null, gender: 'male' }))).rejects.toThrow('chưa có ngày sinh');
  });

  it('UTCID06 [N]: threshold lookup uses the patient age at measuredAt (21) and the measurement time', async () => {
    const prisma = fakePrismaWithThresholds();
    await new RuleBasedDetector(prisma).detect(makeSession([obs('HR', 80)]));

    const where = prisma.vitalSignThreshold.findMany.mock.calls[0][0].where;
    expect(where.AND[0].OR).toEqual([{ ageMin: null }, { ageMin: { lte: 21 } }]);
    expect(where.AND[1].OR).toEqual([{ ageMax: null }, { ageMax: { gte: 21 } }]);
  });
});

describe('VitalSignDetectionOrchestrator (alert creation is idempotent)', () => {
  let prisma: any;
  const abnormal = { observationId: 'o-HR', itemId: 'item-HR', isAbnormal: true, alertLevel: 'critical', alertSource: 'rule', thresholdId: 'th-1', expectedMin: 51, expectedMax: 90, reason: 'HR cao' };
  const normal = { ...abnormal, observationId: 'o-SBP', itemId: 'item-SBP', isAbnormal: false, alertLevel: null, reason: 'ok' };

  beforeEach(() => {
    prisma = {
      vitalSignSession: { findUniqueOrThrow: jest.fn().mockResolvedValue(makeSession([])) },
      vitalSignObservation: { update: jest.fn() },
      vitalSignAlert: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    };
  });

  const detectorReturning = (results: any[], source: 'rule' | 'ai' = 'rule') => ({ source, detect: jest.fn().mockResolvedValue(results) }) as any;

  it('UTCID01 [N]: abnormal observation -> isAbnormal=true and ONE active alert created with the threshold data', async () => {
    await new VitalSignDetectionOrchestrator(prisma, [detectorReturning([abnormal, normal])]).run('vs-01');

    expect(prisma.vitalSignObservation.update).toHaveBeenCalledWith({ where: { observationId: 'o-HR' }, data: { isAbnormal: true } });
    expect(prisma.vitalSignObservation.update).toHaveBeenCalledWith({ where: { observationId: 'o-SBP' }, data: { isAbnormal: false } });
    expect(prisma.vitalSignAlert.create).toHaveBeenCalledTimes(1);
    expect(prisma.vitalSignAlert.create).toHaveBeenCalledWith({
      data: { observationId: 'o-HR', vitalThresholdId: 'th-1', alertLevel: 'critical', expectedMin: 51, expectedMax: 90, status: 'active', reason: 'HR cao' },
    });
  });

  it('UTCID02 [N]: re-running detection (e.g. after a nurse edit) does not duplicate an already active alert', async () => {
    prisma.vitalSignAlert.findFirst.mockResolvedValue({ alertId: 'a-1', status: 'active' });

    await new VitalSignDetectionOrchestrator(prisma, [detectorReturning([abnormal])]).run('vs-01');

    expect(prisma.vitalSignAlert.create).not.toHaveBeenCalled();
  });

  it('UTCID03 [N]: when two detectors disagree on one observation, the abnormal verdict wins', async () => {
    const results = await new VitalSignDetectionOrchestrator(prisma, [
      detectorReturning([{ ...abnormal, isAbnormal: false, alertLevel: null }]),
      detectorReturning([{ ...abnormal, alertSource: 'ai' }], 'ai'),
    ]).run('vs-01');

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ isAbnormal: true, alertSource: 'ai' });
    expect(prisma.vitalSignAlert.create).toHaveBeenCalledTimes(1);
  });

  it('UTCID04 [N]: all-normal session creates no alert', async () => {
    await new VitalSignDetectionOrchestrator(prisma, [detectorReturning([normal])]).run('vs-01');

    expect(prisma.vitalSignAlert.create).not.toHaveBeenCalled();
  });

  it('UTCID05 [N]: default detectors (rule + AI placeholder) work end-to-end on DS-01 data -> 2 alerts', async () => {
    const full = makeSession([obs('HR', 102), obs('SBP', 120), obs('DBP', 92), obs('TEMP', 36.8), obs('RR', 16), obs('SPO2', 98)]);
    prisma.vitalSignSession.findUniqueOrThrow.mockResolvedValue(full);
    Object.assign(prisma, fakePrismaWithThresholds());

    const results = await new VitalSignDetectionOrchestrator(prisma).run('vs-01');

    expect(results.filter((r) => r.isAbnormal)).toHaveLength(2);
    expect(prisma.vitalSignAlert.create).toHaveBeenCalledTimes(2);
  });
});

describe('VitalSignDetectionListener -> VitalAlertGateway (real-time alert)', () => {
  let prisma: any;
  let gateway: { pushAlertUpdate: jest.Mock };
  let listener: VitalSignDetectionListener;
  let run: jest.Mock;

  beforeEach(() => {
    prisma = { vitalSignSession: { findUnique: jest.fn().mockResolvedValue({ encounterId: 'enc-01' }) } };
    gateway = { pushAlertUpdate: jest.fn() };
    listener = new VitalSignDetectionListener(prisma, gateway as any);
    run = jest.fn();
    (listener as any).orchestrator = { run };
  });

  it('UTCID01 [N]: after detection, pushes ONE update for the encounter with abnormalCount (DS-01 step 11: 2 of 9)', async () => {
    const results = [
      ...Array.from({ length: 7 }, (_, i) => ({ observationId: `n${i}`, isAbnormal: false })),
      { observationId: 'o-HR', isAbnormal: true },
      { observationId: 'o-DBP', isAbnormal: true },
    ];
    run.mockResolvedValue(results);

    await listener.handleVitalSessionCreated(new VitalSessionCreatedEvent('vs-01'));

    expect(gateway.pushAlertUpdate).toHaveBeenCalledTimes(1);
    expect(gateway.pushAlertUpdate).toHaveBeenCalledWith({
      vitalSessionId: 'vs-01', encounterId: 'enc-01', totalObservations: 9, abnormalCount: 2, results,
    });
  });

  it('UTCID02 [N]: all-normal session still pushes an update with abnormalCount 0 (UI clears old warnings)', async () => {
    run.mockResolvedValue([{ observationId: 'a', isAbnormal: false }]);

    await listener.handleVitalSessionCreated(new VitalSessionCreatedEvent('vs-01'));

    expect(gateway.pushAlertUpdate).toHaveBeenCalledWith(expect.objectContaining({ abnormalCount: 0 }));
  });

  it('UTCID03 [A]: detection failure is swallowed (no unhandled rejection) and nothing is pushed', async () => {
    run.mockRejectedValue(new Error('Bệnh nhân chưa có ngày sinh'));

    await expect(listener.handleVitalSessionCreated(new VitalSessionCreatedEvent('vs-01'))).resolves.toBeUndefined();
    expect(gateway.pushAlertUpdate).not.toHaveBeenCalled();
  });

  it('UTCID04 [A]: session deleted before detection finished -> nothing is pushed', async () => {
    run.mockResolvedValue([]);
    prisma.vitalSignSession.findUnique.mockResolvedValue(null);

    await listener.handleVitalSessionCreated(new VitalSessionCreatedEvent('vs-01'));

    expect(gateway.pushAlertUpdate).not.toHaveBeenCalled();
  });
});

describe('VitalAlertGateway (rooms per encounter)', () => {
  let gateway: VitalAlertGateway;
  let emit: jest.Mock;
  let to: jest.Mock;

  beforeEach(() => {
    gateway = new VitalAlertGateway();
    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as any;
  });

  it('UTCID01 [N]: subscribe joins room encounter:<id>', () => {
    const client: any = { id: 'c1', join: jest.fn(), leave: jest.fn() };

    expect(gateway.handleSubscribe(client, { encounterId: 'enc-01' })).toEqual({ status: 'subscribed', encounterId: 'enc-01' });
    expect(client.join).toHaveBeenCalledWith('encounter:enc-01');
  });

  it('UTCID02 [N]: unsubscribe leaves the room', () => {
    const client: any = { id: 'c1', join: jest.fn(), leave: jest.fn() };

    gateway.handleUnsubscribe(client, { encounterId: 'enc-01' });

    expect(client.leave).toHaveBeenCalledWith('encounter:enc-01');
  });

  it('UTCID03 [N]: pushAlertUpdate emits "vital-alert-update" ONLY to the matching encounter room', () => {
    const payload: any = { vitalSessionId: 'vs-01', encounterId: 'enc-01', totalObservations: 9, abnormalCount: 2, results: [] };

    gateway.pushAlertUpdate(payload);

    expect(to).toHaveBeenCalledWith('encounter:enc-01');
    expect(emit).toHaveBeenCalledWith('vital-alert-update', payload);
  });

  it.todo('UTCID04 [A]: unauthenticated socket cannot subscribe to an encounter room (gateway currently has no auth, cors "*")');
});
