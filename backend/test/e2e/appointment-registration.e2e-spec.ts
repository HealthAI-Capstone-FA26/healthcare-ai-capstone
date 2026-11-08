import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { client, createE2EApp } from './helpers/app';
import { Fixtures, newPatientPayload, seedFixtures } from './helpers/fixtures';
import { flow, FlowContext } from './helpers/flow';

/**
 * WORKFLOW 1 — Appointment registration (at-hospital):
 * bốc số -> gọi số -> tạo patient + appointment + hoá đơn -> thanh toán tiền mặt -> tạo encounter
 * -> khai báo (lý do khám, danh tính, consent) -> hoàn tất tiếp đón
 * => OUTPUT: encounter 'registered' + 1 entry 'waiting' trong hàng đợi triage (sẵn sàng cho workflow vitals).
 *
 * Các `it` chạy TUẦN TỰ và dùng chung `state`; 1 bước fail thì các bước sau cũng fail (đúng ý workflow).
 */
describe('Workflow 1: appointment registration (at-hospital)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: Fixtures;
  let ctx: FlowContext;

  const state: Record<string, any> = {};

  beforeAll(async () => {
    app = await createE2EApp();
    prisma = app.get(PrismaService);
    fixtures = await seedFixtures(app);
    ctx = { app, fixtures };
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. bệnh nhân bốc số at-hospital -> ticket B### ở trạng thái waiting, chưa có appointment', async () => {
    const ticket = await flow.takeTicket(ctx);

    expect(ticket).toMatchObject({ ticketPrefix: 'B', status: 'waiting', appointmentId: null });
    expect(ticket.ticketNumber).toBeGreaterThanOrEqual(1);
    state.ticketId = ticket.ticketId;
  });

  it('2. lễ tân gọi số -> ticket chuyển sang called', async () => {
    const called = await flow.callTicket(ctx, state.ticketId);

    expect(called.status).toBe('called');
    expect(called.counterNumber).toBe('Quầy 1');
  });

  it('3. lễ tân nhập thông tin -> tạo patient + appointment walk_in (confirmed) + hoá đơn phí khám pending', async () => {
    const served = await flow.serveTicket(ctx, state.ticketId, newPatientPayload());

    expect(served.queueTicket.status).toBe('done');
    expect(served.appointment).toMatchObject({
      bookingChannel: 'walk_in',
      status: 'confirmed',
      doctorId: fixtures.doctor.doctorId,
    });
    expect(served.appointment.patientId).toBeTruthy();
    expect(served.invoice).toMatchObject({ status: 'pending' });
    expect(Number(served.invoice.totalAmount)).toBeGreaterThan(0);

    state.appointmentId = served.appointment.appointmentId;
    state.patientId = served.appointment.patientId;
    state.invoice = served.invoice;
  });

  it('4. [exception] chưa trả phí khám thì KHÔNG tạo được encounter', async () => {
    const res = await client(app, fixtures.receptionist.token).post(
      `/encounters/from-paid-appointment/${state.appointmentId}`,
    );

    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('chưa thanh toán phí khám');
  });

  it('5. [exception] thu sai số tiền bị từ chối', async () => {
    const res = await client(app, fixtures.receptionist.token).post('/payments/cash', {
      invoiceId: state.invoice.invoiceId,
      amount: Number(state.invoice.totalAmount) - 1,
    });

    expect(res.status).toBe(400);
  });

  it('6. thu tiền mặt đúng số tiền -> payment success, hoá đơn chuyển paid', async () => {
    const { payment, confirmed } = await flow.payInvoiceByCash(ctx, state.invoice);

    expect(payment).toMatchObject({ paymentMethod: 'cash', status: 'pending' });
    expect(confirmed).toMatchObject({ paymentId: payment.paymentId, status: 'success' });

    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { invoiceId: state.invoice.invoiceId } });
    expect(invoice.status).toBe('paid');
  });

  it('7. tạo encounter sau thanh toán -> encounter arrived, appointment checked_in, invoice gắn vào encounter', async () => {
    const encounter = await flow.createEncounter(ctx, state.appointmentId);

    expect(encounter).toMatchObject({
      appointmentId: state.appointmentId,
      patientId: state.patientId,
      doctorId: fixtures.doctor.doctorId,
      status: 'arrived',
    });
    expect(encounter.encounterCode).toMatch(/^LK/);

    const appointment = await prisma.appointment.findUniqueOrThrow({ where: { appointmentId: state.appointmentId } });
    expect(appointment.status).toBe('checked_in');
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { invoiceId: state.invoice.invoiceId } });
    expect(invoice.encounterId).toBe(encounter.encounterId);

    state.encounterId = encounter.encounterId;
  });

  it('8. [exception] chưa khai báo xong thì hoàn tất tiếp đón bị chặn và báo đủ các mục còn thiếu', async () => {
    const res = await client(app, fixtures.receptionist.token).post(
      `/encounters/${state.encounterId}/complete-registration`,
    );

    expect(res.status).toBe(400);
    const missing: string[] = res.body.missing;
    expect(missing).toHaveLength(4); // lý do khám + danh tính + 2 consent bắt buộc (phí khám đã trả)
    expect(missing.join(' | ')).toContain('chief complaint');
    expect(missing.join(' | ')).toContain('danh tính');
    expect(missing.join(' | ')).toContain('data_processing');
    expect(missing.join(' | ')).toContain('treatment_consent');
  });

  it('9. khai báo lý do khám + xác minh danh tính + ký 2 consent bắt buộc', async () => {
    const complaint = await flow.addChiefComplaint(ctx, state.encounterId);
    expect(complaint).toMatchObject({ encounterId: state.encounterId, painLevel: 3 });

    const verification = await flow.verifyIdentity(ctx, state.encounterId);
    expect(verification.verificationStatus).toBe('verified');

    const consents = await flow.signMandatoryConsents(ctx, state.encounterId, state.patientId);
    expect(consents).toHaveLength(2);
    consents.forEach((consent) => expect(consent.status).toBe('active'));
  });

  it('10. hoàn tất tiếp đón -> encounter registered + vào hàng đợi triage (waiting, gán y tá)', async () => {
    const result = await flow.completeRegistration(ctx, state.encounterId);

    expect(result.encounter).toMatchObject({ encounterId: state.encounterId, status: 'registered' });
    expect(result.triageQueueEntry).toMatchObject({
      encounterId: state.encounterId,
      status: 'waiting',
      assignedNurseUserId: fixtures.nurse.userId,
    });
    state.triageQueueEntryId = result.triageQueueEntry.queueEntryId;
  });

  it('11. [exception] hoàn tất tiếp đón lần 2 bị chặn, không tạo trùng entry triage', async () => {
    const res = await client(app, fixtures.receptionist.token).post(
      `/encounters/${state.encounterId}/complete-registration`,
    );

    expect(res.status).toBe(400);
    const entries = await prisma.triageQueueEntry.count({ where: { encounterId: state.encounterId } });
    expect(entries).toBe(1);
  });

  it('12. kết quả cuối: GET /encounters/:id và GET /triage-queue phản ánh đúng', async () => {
    const encounter = (await client(app, fixtures.receptionist.token).get(`/encounters/${state.encounterId}`)).body;
    expect(encounter).toMatchObject({ status: 'registered', patientId: state.patientId });
    expect(encounter.chiefComplaint).toBeTruthy();
    expect(encounter.identityVerifications).toHaveLength(1);
    expect(encounter.consents).toHaveLength(2);

    const queue = (await client(app, fixtures.nurse.token).get('/triage-queue?status=waiting')).body;
    expect(queue.map((entry: any) => entry.queueEntryId)).toContain(state.triageQueueEntryId);
  });
});
