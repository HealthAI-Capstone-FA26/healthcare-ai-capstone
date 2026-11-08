import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { client, createE2EApp, expectSuccess } from './helpers/app';
import { Fixtures, seedFixtures } from './helpers/fixtures';
import { FlowContext, runRegistrationFlow } from './helpers/flow';

/**
 * WORKFLOW 2 — Vitals: điểm bắt đầu là 1 encounter đã tiếp đón xong (kết quả của workflow 1, dựng lại
 * bằng chính các API thật trong beforeAll) và đang chờ ở hàng đợi triage.
 *
 * y tá gọi bệnh nhân -> bắt đầu đo -> ghi sinh hiệu (hoàn tất triage + encounter waiting_for_doctor cùng 1 transaction)
 * -> điều phối vào hàng đợi bác sĩ
 * => OUTPUT: encounter đã đo sinh hiệu, 'waiting_for_doctor', và có DoctorQueueEntry 'waiting' của bác sĩ trực.
 */
describe('Workflow 2: vitals -> doctor queue', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: Fixtures;
  let ctx: FlowContext;

  const state: Record<string, any> = {};

  const vitals = {
    pulse: 78,
    systolicBp: 120,
    diastolicBp: 80,
    temperature: 36.8,
    respiratoryRate: 16,
    spo2: 98,
    height: 170,
    weight: 65,
  };

  beforeAll(async () => {
    app = await createE2EApp();
    prisma = app.get(PrismaService);
    fixtures = await seedFixtures(app);
    ctx = { app, fixtures };

    // Tiền điều kiện = output của workflow 1.
    Object.assign(state, await runRegistrationFlow(ctx));
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. tiền điều kiện: encounter registered và đang waiting ở hàng đợi triage của y tá', async () => {
    const encounter = await prisma.encounter.findUniqueOrThrow({ where: { encounterId: state.encounterId } });
    expect(encounter.status).toBe('registered');

    const queue = expectSuccess(await client(app, fixtures.nurse.token).get('/triage-queue?status=waiting'), 'list triage queue');
    expect(queue.map((entry: any) => entry.queueEntryId)).toContain(state.triageQueueEntryId);
  });

  it('2. y tá gọi bệnh nhân tiếp theo (dequeue) -> entry called', async () => {
    const entry = expectSuccess(await client(app, fixtures.nurse.token).post('/triage-queue/dequeue'), 'dequeue');

    expect(entry).toMatchObject({
      queueEntryId: state.triageQueueEntryId,
      encounterId: state.encounterId,
      status: 'called',
      assignedNurseUserId: fixtures.nurse.userId,
    });
  });

  it('3. y tá bắt đầu đo -> entry in_progress', async () => {
    const entry = expectSuccess(
      await client(app, fixtures.nurse.token).patch(`/triage-queue/${state.triageQueueEntryId}/start`),
      'start triage',
    );

    expect(entry.status).toBe('in_progress');
  });

  it('4. [exception] chưa có sinh hiệu thì KHÔNG điều phối được vào hàng đợi bác sĩ', async () => {
    const res = await client(app, fixtures.nurse.token).post(`/encounters/${state.encounterId}/route-doctor`);

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('chưa có phiên ghi nhận sinh hiệu');
    expect(await prisma.doctorQueueEntry.count({ where: { encounterId: state.encounterId } })).toBe(0);
  });

  it('5. [exception] giá trị sinh hiệu ngoài khoảng cho phép bị validation chặn', async () => {
    const res = await client(app, fixtures.nurse.token).post('/vital-sessions', {
      encounterId: state.encounterId,
      patientId: state.patientId,
      recordedByUserId: fixtures.nurse.userId,
      temperature: 99,
    });

    expect(res.status).toBe(400);
  });

  it('6. y tá ghi sinh hiệu kèm queueEntryId -> có BMI tự tính, triage done, encounter waiting_for_doctor', async () => {
    const session = expectSuccess(
      await client(app, fixtures.nurse.token).post('/vital-sessions', {
        encounterId: state.encounterId,
        patientId: state.patientId,
        recordedByUserId: fixtures.nurse.userId,
        queueEntryId: state.triageQueueEntryId,
        ...vitals,
      }),
      'record vitals',
    );

    const byCode = Object.fromEntries(session.observations.map((o: any) => [o.item.itemCode, Number(o.observationValue)]));
    expect(byCode).toMatchObject({
      HR: 78,
      SBP: 120,
      DBP: 80,
      TEMP: 36.8,
      RR: 16,
      SPO2: 98,
      HEIGHT: 170,
      WEIGHT: 65,
    });
    expect(byCode.BMI).toBeCloseTo(22.49, 1); // 65 / 1.7^2

    const triage = expectSuccess(await client(app, fixtures.nurse.token).get(`/triage-queue/${state.triageQueueEntryId}`), 'get triage entry');
    expect(triage.status).toBe('done');

    const encounter = await prisma.encounter.findUniqueOrThrow({ where: { encounterId: state.encounterId } });
    expect(encounter.status).toBe('waiting_for_doctor');

    state.vitalSessionId = session.vitalSessionId;
  });

  it('7. lịch sử sinh hiệu: /vital-sessions/latest và danh sách trả đúng phiên vừa ghi', async () => {
    const http = client(app, fixtures.nurse.token);

    const latest = expectSuccess(await http.get(`/vital-sessions/latest?encounterId=${state.encounterId}`), 'latest vitals');
    expect(latest.vitalSessionId).toBe(state.vitalSessionId);

    const list = expectSuccess(await http.get(`/vital-sessions?encounterId=${state.encounterId}`), 'list vitals');
    expect(list).toHaveLength(1);
  });

  it('8. điều phối vào hàng đợi bác sĩ -> bác sĩ trực nhận bệnh nhân, entry waiting', async () => {
    const result = expectSuccess(
      await client(app, fixtures.nurse.token).post(`/encounters/${state.encounterId}/route-doctor`),
      'route to doctor',
    );

    expect(result.current.encounterStatus).toBe('waiting_for_doctor');
    expect(result.queueEntry).toMatchObject({
      encounterId: state.encounterId,
      doctorId: fixtures.doctor.doctorId,
      status: 'waiting',
      queueOrder: 1,
      intakeChannel: 'walk_in',
    });
  });

  it('9. [exception] điều phối lần 2 bị chặn, không tạo trùng entry', async () => {
    const res = await client(app, fixtures.nurse.token).post(`/encounters/${state.encounterId}/route-doctor`);

    expect(res.status).toBe(400);
    expect(await prisma.doctorQueueEntry.count({ where: { encounterId: state.encounterId } })).toBe(1);
  });

  it('10. kết quả cuối: encounter đã đo vital + nằm trong doctor queue', async () => {
    const encounter = expectSuccess(
      await client(app, fixtures.doctor.token).get(`/encounters/${state.encounterId}`),
      'final encounter',
    );

    expect(encounter).toMatchObject({ status: 'waiting_for_doctor', doctorId: fixtures.doctor.doctorId });
    expect(encounter.vitalSignSessions).toHaveLength(1);
    expect(encounter.vitalSignSessions[0].observations.length).toBeGreaterThanOrEqual(9); // 8 chỉ số + BMI
    expect(encounter.doctorQueueEntry).toMatchObject({ doctorId: fixtures.doctor.doctorId, status: 'waiting' });
  });
});
