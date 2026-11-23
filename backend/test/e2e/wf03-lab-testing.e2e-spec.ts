import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LabAlertGateway } from '../../src/modules/lab-test/lab-anomaly/lab-alert.gateway';
import { client, createE2EApp, expectSuccess } from './helpers/app';
import { Fixtures, seedFixtures } from './helpers/fixtures';
import { FlowContext } from './helpers/flow';
import {
  ControllableEcgProvider,
  ECG_ANOMALY_PROVIDER,
  OrderedEncounter,
  TINY_PNG,
  Wf03Actors,
  ageAt,
  buildBloodValues,
  buildEcgCsv,
  ensureActiveEcgModel,
  orderDiagnostics,
  payDiagnosticsInvoice,
  seedLabActors,
  waitFor,
} from './helpers/wf03';

/**
 * WORKFLOW 3 (WF-03) — Paraclinical Laboratory Testing and Batch-Inference ECG Anomaly Detection.
 * CI automation cho 2 demo scenario trong Commitment: DS-05 (main) và DS-06 (exception).
 *
 * Tiền điều kiện (output của WF-01/WF-02) được dựng bằng CHÍNH các API thật: đăng ký -> sinh hiệu -> điều phối bác sĩ
 * -> chẩn đoán I20.9 -> chỉ định CLS -> hoá đơn diagnostics. Sau đó WF-03 chạy end-to-end qua HTTP:
 *   KTV nhận task -> nhập kết quả máu (HGB nguy kịch) -> tải ECG lên MinIO -> AI batch chạy nền -> cảnh báo
 *   -> mọi task xong => order completed + encounter awaiting_review + thông báo -> bác sĩ xác nhận cảnh báo & chốt kết quả.
 * Chỉ dịch vụ AI Python được thay bằng test double (ControllableEcgProvider); DB/Redis/MinIO/event listener là thật.
 */
describe('Workflow 3: lab testing + ECG AI anomaly detection', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let fixtures: Fixtures;
  let ctx: FlowContext;
  let labActors: Wf03Actors;
  const ai = new ControllableEcgProvider();

  const labStaff = () => client(app, labActors.labStaff.token);

  beforeAll(async () => {
    app = await createE2EApp((b) => b.overrideProvider(ECG_ANOMALY_PROVIDER).useValue(ai));
    prisma = app.get(PrismaService);
    fixtures = await seedFixtures(app);
    labActors = await seedLabActors(app);
    ctx = { app, fixtures };
    await ensureActiveEcgModel(app);
  }, 180_000);

  afterAll(async () => {
    await app.close();
  });

  // ================================================================================================================
  describe('DS-05 (main): blood test (critical HGB) + ECG with AI anomaly', () => {
    let ordered: OrderedEncounter;
    let bloodResultId: string;
    let ecgRecordingId: string;
    let ecgAnalysisId: string;
    let hgbAlertId: string;
    let realtimeSpy: jest.SpyInstance;

    beforeAll(async () => {
      ordered = await orderDiagnostics(ctx, labActors, ['blood_test', 'ecg']);
      ai.mode = 'anomaly';
      ai.calls = [];
      realtimeSpy = jest.spyOn(app.get(LabAlertGateway, { strict: false }), 'pushAlertUpdate');
    }, 180_000);

    afterAll(() => realtimeSpy?.mockRestore());

    it('1. tiền điều kiện: encounter awaiting_diagnostics, order có 2 chỉ định, task payment_pending (chưa thanh toán)', async () => {
      const encounter = await prisma.encounter.findUniqueOrThrow({ where: { encounterId: ordered.encounterId } });
      expect(encounter.status).toBe('awaiting_diagnostics');
      expect(Object.keys(ordered.tasks).sort()).toEqual(['blood_test', 'ecg']);

      for (const { taskId } of Object.values(ordered.tasks)) {
        const task = await prisma.diagnosticTask.findUniqueOrThrow({ where: { taskId } });
        expect(task).toMatchObject({ status: 'payment_pending', paymentVerified: false });
      }
    });

    it('2. [F-09 exception] task chưa thanh toán KHÔNG được tiếp nhận (403), trạng thái không đổi', async () => {
      const res = await labStaff().post(`/lab-tasks/${ordered.tasks.blood_test.taskId}/receive`, {});

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).toContain('chưa hoàn tất thanh toán');
      const task = await prisma.diagnosticTask.findUniqueOrThrow({ where: { taskId: ordered.tasks.blood_test.taskId } });
      expect(task.status).toBe('payment_pending');
    });

    it('3. lễ tân thu đủ tiền -> cả 2 task ready + paymentVerified, xuất hiện trên worklist của phòng', async () => {
      await payDiagnosticsInvoice(ctx, ordered);

      const worklist = expectSuccess(
        await labStaff().get(`/lab-tasks?status=ready&diagnosticRoomId=${ordered.tasks.blood_test.diagnosticRoomId}`),
        'blood worklist',
      );
      expect(worklist.map((t: any) => t.taskId)).toContain(ordered.tasks.blood_test.taskId);
    });

    it('4. [RBAC] bác sĩ KHÔNG có quyền tiếp nhận task phòng xét nghiệm (403)', async () => {
      const res = await client(app, ordered.doctor.token).post(`/lab-tasks/${ordered.tasks.blood_test.taskId}/receive`, {});

      expect(res.status).toBe(403);
      const task = await prisma.diagnosticTask.findUniqueOrThrow({ where: { taskId: ordered.tasks.blood_test.taskId } });
      expect(task.status).toBe('ready');
    });

    it('5. KTV tiếp nhận task máu -> in_progress; order in_progress, encounter diagnostics_in_progress', async () => {
      const task = expectSuccess(
        await labStaff().post(`/lab-tasks/${ordered.tasks.blood_test.taskId}/receive`, { specimenCode: 'E2E-TUBE-001' }),
        'receive blood task',
      );

      expect(task).toMatchObject({ status: 'in_progress', assignedStaffUserId: labActors.labStaff.userId });
      const order = await prisma.diagnosticOrder.findUniqueOrThrow({ where: { orderId: ordered.orderId } });
      const encounter = await prisma.encounter.findUniqueOrThrow({ where: { encounterId: ordered.encounterId } });
      expect(order.status).toBe('in_progress');
      expect(encounter.status).toBe('diagnostics_in_progress');
    });

    it('6. KTV nhập kết quả máu (HGB ngoài ngưỡng an toàn) -> task completed, encounter CHƯA xong vì ECG còn chờ', async () => {
      const detail = expectSuccess(await labStaff().get(`/lab-tasks/${ordered.tasks.blood_test.taskId}`), 'blood task detail');
      const { values, criticalParameterId } = buildBloodValues(
        detail,
        { age: ageAt(ordered.patientDob), gender: 'male' },
        { parameterCode: /^(HGB|HB)$/i },
      );

      const result = expectSuccess(
        await labStaff().post(`/lab-tasks/${ordered.tasks.blood_test.taskId}/results`, {
          values,
          overallConclusion: 'Thiếu máu nặng (E2E)',
          resultStatus: 'preliminary',
        }),
        'submit blood result',
      );

      expect(result.resultStatus).toBe('preliminary');
      expect(result.values.length).toBe(values.length);
      expect(result.values.map((v: any) => v.parameterId)).toContain(criticalParameterId);
      bloodResultId = result.resultId;

      const task = await prisma.diagnosticTask.findUniqueOrThrow({ where: { taskId: ordered.tasks.blood_test.taskId } });
      const encounter = await prisma.encounter.findUniqueOrThrow({ where: { encounterId: ordered.encounterId } });
      expect(task.status).toBe('completed');
      expect(encounter.status).toBe('diagnostics_in_progress');
    });

    it('7. [F-10] rule-based phát hiện HGB critical -> ResultValueAlert active, đẩy realtime, báo thẳng bác sĩ', async () => {
      const alert = await waitFor(
        async () =>
          prisma.resultValueAlert.findFirst({
            where: { encounterId: ordered.encounterId, status: 'active', riskLevel: { in: ['critical', 'high'] } },
          }),
        'ResultValueAlert HGB được tạo bởi detection chạy nền',
      );
      hgbAlertId = alert.alertId;
      expect(alert.riskLevel).toBe('critical');

      // realtime: gateway /lab-alerts được gọi với ít nhất 1 giá trị bất thường của đúng encounter
      await waitFor(async () => realtimeSpy.mock.calls.length > 0, 'LabAlertGateway.pushAlertUpdate được gọi');
      const pushed = realtimeSpy.mock.calls.map((c) => c[0]).find((p: any) => p.labResultId === bloodResultId);
      expect(pushed).toMatchObject({ encounterId: ordered.encounterId });
      expect(pushed.abnormalCount).toBeGreaterThanOrEqual(1);

      // critical -> thông báo in-app cho bác sĩ phụ trách
      const notification = await waitFor(
        async () => prisma.notification.findFirst({ where: { recipientUserId: ordered.doctor.userId, notificationType: 'critical_value_alert', referenceId: alert.alertId } }),
        'thông báo critical_value_alert cho bác sĩ',
      );
      expect(notification.channel).toBe('in_app');
    });

    it('8. KTV tiếp nhận task ECG và tải tín hiệu .csv -> bản ghi completed, tín hiệu nằm trên MinIO', async () => {
      expectSuccess(await labStaff().post(`/lab-tasks/${ordered.tasks.ecg.taskId}/receive`, {}), 'receive ecg task');

      const ecg = buildEcgCsv();
      const res = await labStaff()
        .multipart(`/lab-tasks/${ordered.tasks.ecg.taskId}/ecg-recordings`)
        .field('recordingType', 'resting_12_lead')
        .field('signalFormat', 'csv')
        .field('sampleRateHz', '500')
        .field('numLeads', String(ecg.numLeads))
        .field('leadNames', ecg.leadNames)
        .field('durationMs', '5000')
        .attach('file', ecg.buffer, { filename: 'ECG_e2e_ds05.csv', contentType: 'text/csv' });
      const recording = expectSuccess(res, 'upload ecg');

      expect(recording.status).toBe('completed');
      ecgRecordingId = recording.ecgRecordingId;

      const row = await prisma.ecgRecording.findUniqueOrThrow({ where: { ecgRecordingId } });
      expect(row.signalFileUrl).toMatch(new RegExp(`^ecg/${ordered.encounterId}/${ecgRecordingId}\\.csv$`));
      const signal = expectSuccess(await labStaff().get(`/ecg-recordings/${ecgRecordingId}/signal-url`), 'signal url');
      expect(signal.url).toContain(ecgRecordingId);
    });

    it('9. [F-11] AI batch chạy NỀN -> analysis completed, isCurrent, có anomaly event + thông báo ecg_anomaly_alert', async () => {
      const analysis = await waitFor(
        async () => {
          const a = await prisma.ecgAiAnalysis.findFirst({ where: { ecgRecordingId } });
          return a && ['completed', 'failed', 'skipped'].includes(a.status) ? a : null;
        },
        'EcgAiAnalysis kết thúc',
      );
      expect(analysis).toMatchObject({ status: 'completed', overallResult: 'abnormal', isCurrent: true });
      expect(analysis.anomalyCount).toBe(1);
      expect(ai.calls).toHaveLength(1);
      expect(ai.calls[0].recordingId).toBe(ecgRecordingId);
      ecgAnalysisId = analysis.analysisId;

      const events = expectSuccess(await client(app, ordered.doctor.token).get(`/encounters/${ordered.encounterId}/ecg-anomaly-events`), 'ecg events');
      const list: any[] = Array.isArray(events) ? events : (events.items ?? events.data ?? []);
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ anomalyType: 'afib', severity: 'high', alertStatus: 'active' });

      const notification = await prisma.notification.findFirst({
        where: { recipientUserId: ordered.doctor.userId, notificationType: 'ecg_anomaly_alert', referenceId: ecgAnalysisId },
      });
      expect(notification).not.toBeNull();
    });

    it('10. KTV nhập kết quả ECG -> mọi task completed => order completed, encounter awaiting_review', async () => {
      const result = expectSuccess(
        await labStaff().post(`/lab-tasks/${ordered.tasks.ecg.taskId}/results`, {
          findings: 'Nhịp nhanh, nghi rung nhĩ cơn (theo AI, E2E).',
          overallConclusion: 'ECG bất thường',
          resultStatus: 'final',
        }),
        'submit ecg result',
      );
      expect(result.resultStatus).toBe('final');

      const order = await prisma.diagnosticOrder.findUniqueOrThrow({ where: { orderId: ordered.orderId } });
      const encounter = await prisma.encounter.findUniqueOrThrow({ where: { encounterId: ordered.encounterId } });
      const tasks = await prisma.diagnosticTask.findMany({ where: { orderItem: { orderId: ordered.orderId } } });
      expect(tasks.every((t) => t.status === 'completed')).toBe(true);
      expect(order.status).toBe('completed');
      expect(order.completedAt).not.toBeNull();
      expect(encounter.status).toBe('awaiting_review');
    });

    it('11. [F-15] thông báo hoàn tất: bác sĩ và bệnh nhân đều nhận thông báo in-app khi encounter vào awaiting_review', async () => {
      const forDoctor = await waitFor(
        async () => prisma.notification.findFirst({ where: { recipientUserId: ordered.doctor.userId, notificationType: 'diagnostics_completed', referenceId: ordered.encounterId } }),
        'thông báo diagnostics_completed cho bác sĩ',
      );
      expect(forDoctor.channel).toBe('in_app');

      const forPatient = await waitFor(async () => {
        const rows = await prisma.notification.findMany({
          where: { recipientPatientId: ordered.patientId, notificationType: 'diagnostics_completed', referenceId: ordered.encounterId },
        });
        return rows.length > 0 && rows;
      }, 'thông báo diagnostics_completed cho bệnh nhân');
      expect(forPatient.map((n) => n.channel)).toContain('in_app');
    });

    it('12. bác sĩ xem kết quả, xác nhận cảnh báo HGB + ECG, chốt kết quả -> final, có reviewedBy/reviewedAt', async () => {
      const doctor = client(app, ordered.doctor.token);

      const ecgResult = expectSuccess(await doctor.get(`/lab-tasks/${ordered.tasks.ecg.taskId}/result`), 'ecg result');
      expect(ecgResult.overallConclusion).toBe('ECG bất thường');

      const alerts = expectSuccess(await doctor.get(`/encounters/${ordered.encounterId}/result-alerts?status=active`), 'active alerts');
      expect(alerts.map((a: any) => a.alertId)).toContain(hgbAlertId);

      expectSuccess(await doctor.patch(`/result-alerts/${hgbAlertId}/confirm`), 'confirm HGB alert');
      const event = await prisma.ecgAnomalyEvent.findFirstOrThrow({ where: { analysisId: ecgAnalysisId } });
      expectSuccess(await doctor.patch(`/ecg-anomaly-events/${event.eventId}/acknowledge`), 'ack ECG event');
      expect((await prisma.resultValueAlert.findUniqueOrThrow({ where: { alertId: hgbAlertId } })).status).toBe('confirmed');
      expect((await prisma.ecgAnomalyEvent.findUniqueOrThrow({ where: { eventId: event.eventId } })).alertStatus).toBe('acknowledged');

      // preliminary -> final: chốt kết quả máu (đủ Full panel nên được phép)
      const reviewed = expectSuccess(await doctor.post(`/lab-results/${bloodResultId}/review`, { finalize: true }), 'review blood result');
      expect(reviewed.resultStatus).toBe('final');
      expect(reviewed.reviewedByUserId).toBe(ordered.doctor.userId);
      expect(reviewed.reviewedAt).toBeTruthy();
    });

    it('13. kết quả cuối: encounter awaiting_review, sẵn sàng cho WF-04, cảnh báo đã được xử lý', async () => {
      const encounter = expectSuccess(await client(app, ordered.doctor.token).get(`/encounters/${ordered.encounterId}`), 'final encounter');
      expect(encounter.status).toBe('awaiting_review');

      const alert = await prisma.resultValueAlert.findUniqueOrThrow({ where: { alertId: hgbAlertId } });
      expect(alert.status).toBe('confirmed');
      const resultCount = await prisma.diagnosticResult.count({ where: { task: { orderItem: { orderId: ordered.orderId } } } });
      expect(resultCount).toBe(2);
    });
  });

  // ================================================================================================================
  describe('DS-06 (exception): AI failure never blocks the workflow + X-ray image report', () => {
    let ordered: OrderedEncounter;
    let ecgRecordingId: string;
    let xrayResultId: string;

    beforeAll(async () => {
      ordered = await orderDiagnostics(ctx, labActors, ['ecg', 'xray']);
      await payDiagnosticsInvoice(ctx, ordered);
      ai.mode = 'fail';
      ai.calls = [];
    }, 180_000);

    it('1. KTV tiếp nhận ECG và tải tín hiệu -> bản ghi được lưu bình thường', async () => {
      expectSuccess(await labStaff().post(`/lab-tasks/${ordered.tasks.ecg.taskId}/receive`, {}), 'receive ecg task');

      const ecg = buildEcgCsv();
      const recording = expectSuccess(
        await labStaff()
          .multipart(`/lab-tasks/${ordered.tasks.ecg.taskId}/ecg-recordings`)
          .field('recordingType', 'resting_12_lead')
          .field('signalFormat', 'csv')
          .field('sampleRateHz', '500')
          .field('numLeads', String(ecg.numLeads))
          .field('leadNames', ecg.leadNames)
          .field('durationMs', '5000')
          .attach('file', ecg.buffer, { filename: 'ECG_e2e_ds06.csv', contentType: 'text/csv' }),
        'upload ecg',
      );
      expect(recording.status).toBe('completed');
      ecgRecordingId = recording.ecgRecordingId;
    });

    it('2. [F-11 exception] AI lỗi ở nền -> analysis failed + errorCode, KHÔNG có anomaly event/alert nào', async () => {
      const analysis = await waitFor(
        async () => {
          const a = await prisma.ecgAiAnalysis.findFirst({ where: { ecgRecordingId } });
          return a && ['completed', 'failed', 'skipped'].includes(a.status) ? a : null;
        },
        'EcgAiAnalysis kết thúc (failed)',
      );
      expect(analysis).toMatchObject({ status: 'failed', errorCode: 'AI_UNAVAILABLE' });
      expect(ai.calls).toHaveLength(1);

      expect(await prisma.ecgAnomalyEvent.count({ where: { analysisId: analysis.analysisId } })).toBe(0);
      expect(
        await prisma.notification.count({ where: { notificationType: 'ecg_anomaly_alert', referenceId: analysis.analysisId } }),
      ).toBe(0);

      // task KHÔNG bị chặn: vẫn in_progress, KTV nhập tay được
      const task = await prisma.diagnosticTask.findUniqueOrThrow({ where: { taskId: ordered.tasks.ecg.taskId } });
      expect(task.status).toBe('in_progress');
    });

    it('3. KTV nhập kết quả ECG thủ công -> task completed dù AI lỗi', async () => {
      const result = expectSuccess(
        await labStaff().post(`/lab-tasks/${ordered.tasks.ecg.taskId}/results`, {
          findings: 'Nhịp xoang, không thấy bất thường rõ (đọc thủ công, E2E).',
          overallConclusion: 'ECG trong giới hạn bình thường',
          resultStatus: 'final',
        }),
        'submit manual ecg result',
      );

      expect(result.resultStatus).toBe('final');
      const task = await prisma.diagnosticTask.findUniqueOrThrow({ where: { taskId: ordered.tasks.ecg.taskId } });
      expect(task.status).toBe('completed');
    });

    it('4. X-quang: KTV tiếp nhận, nhập báo cáo -> kết quả được lưu nhưng task CHƯA completed (chờ hình ảnh)', async () => {
      expectSuccess(await labStaff().post(`/lab-tasks/${ordered.tasks.xray.taskId}/receive`, {}), 'receive xray task');

      const result = expectSuccess(
        await labStaff().post(`/lab-tasks/${ordered.tasks.xray.taskId}/results`, {
          findings: 'Bóng tim không to, phổi sáng đều hai bên (E2E).',
          overallConclusion: 'X-quang ngực bình thường',
          resultStatus: 'final',
        }),
        'submit xray result',
      );
      xrayResultId = result.resultId;

      const task = await prisma.diagnosticTask.findUniqueOrThrow({ where: { taskId: ordered.tasks.xray.taskId } });
      expect(task.status).toBe('in_progress');
    });

    it('5. [exception] hoàn tất X-quang khi chưa có ảnh và không nêu lý do -> 400, task vẫn in_progress', async () => {
      const res = await labStaff().post(`/lab-results/${xrayResultId}/complete`, {});

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('Chưa có hình ảnh');
      const task = await prisma.diagnosticTask.findUniqueOrThrow({ where: { taskId: ordered.tasks.xray.taskId } });
      expect(task.status).toBe('in_progress');
    });

    it('6. tải ảnh X-quang lên object storage rồi hoàn tất -> task completed, order completed, encounter awaiting_review', async () => {
      const attachment = expectSuccess(
        await labStaff()
          .multipart(`/lab-results/${xrayResultId}/attachments`)
          .field('fileType', 'image')
          .field('attachmentRole', 'primary')
          .field('metadata', JSON.stringify({ view: 'PA' }))
          .attach('file', TINY_PNG, { filename: 'xray_e2e.png', contentType: 'image/png' }),
        'upload xray image',
      );
      expect(attachment.fileUrl).toMatch(new RegExp(`^diagnostic-attachments/${xrayResultId}/.+\\.png$`));

      const access = expectSuccess(await labStaff().get(`/lab-attachments/${attachment.attachmentId}/access-url`), 'attachment access url');
      expect(JSON.stringify(access)).toContain(xrayResultId);

      expectSuccess(await labStaff().post(`/lab-results/${xrayResultId}/complete`, {}), 'complete xray result');

      const order = await prisma.diagnosticOrder.findUniqueOrThrow({ where: { orderId: ordered.orderId } });
      const encounter = await prisma.encounter.findUniqueOrThrow({ where: { encounterId: ordered.encounterId } });
      const tasks = await prisma.diagnosticTask.findMany({ where: { orderItem: { orderId: ordered.orderId } } });
      expect(tasks.every((t) => t.status === 'completed')).toBe(true);
      expect(order.status).toBe('completed');
      expect(encounter.status).toBe('awaiting_review');
    });

    it('7. bác sĩ mở ca: ECG thể hiện AI không khả dụng (analysis failed) và ảnh X-quang hiển thị, sẵn sàng review', async () => {
      const doctor = client(app, ordered.doctor.token);

      const ecgTask = expectSuccess(await doctor.get(`/lab-tasks/${ordered.tasks.ecg.taskId}`), 'ecg task detail');
      expect(ecgTask.ecgRecordings).toHaveLength(1);
      const recordings = expectSuccess(await doctor.get(`/lab-tasks/${ordered.tasks.ecg.taskId}/ecg-recordings`), 'ecg recordings');
      expect(recordings[0].analyses[0]).toMatchObject({ status: 'failed', errorCode: 'AI_UNAVAILABLE' });

      const attachments = expectSuccess(await doctor.get(`/lab-results/${xrayResultId}/attachments`), 'xray attachments');
      expect(attachments).toHaveLength(1);

      const events = expectSuccess(await doctor.get(`/encounters/${ordered.encounterId}/ecg-anomaly-events`), 'ecg events');
      expect(Array.isArray(events) ? events : (events.items ?? events.data ?? [])).toHaveLength(0);

      const encounter = expectSuccess(await doctor.get(`/encounters/${ordered.encounterId}`), 'final encounter');
      expect(encounter.status).toBe('awaiting_review');
    });
  });
});
