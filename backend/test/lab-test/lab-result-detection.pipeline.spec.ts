import { RuleBasedLabDetector } from '../../src/modules/lab-test/lab-anomaly/detectors/rule-based.detector';
import { LabResultDetectionOrchestrator } from '../../src/modules/lab-test/lab-anomaly/orchestrators/lab-result-detection.orchestrator';
import { LabResultDetectionListener } from '../../src/modules/lab-test/lab-anomaly/listeners/lab-result-detection.listener';
import { LabResultSubmittedEvent } from '../../src/modules/lab-test/lab-anomaly/events/lab-result-submitted.event';
import { Logger } from '@nestjs/common';

// @nestjs/event-emitter phát hành ESM — Jest (CJS) không nạp được; chỉ cần kiểu/decorator nên mock rỗng.
jest.mock('@nestjs/event-emitter', () => ({ EventEmitter2: class {}, OnEvent: () => () => undefined }));

/**
 * WF-03 · F-10 "Rule-based blood alert" — acceptance: "Out-of-range value raises real-time alerts"
 *        (và F-09: "a critical lab value raises an alert").
 *
 * Function 17 (bổ sung, UTCID07..13): chuỗi thật RuleBasedLabDetector -> LabResultDetectionOrchestrator
 * -> LabResultDetectionListener. UTCID01..06 (RuleBasedLabDetector.detect) nằm ở rule-based-lab.detector.spec.ts.
 * Chỉ giả lập biên: Prisma (in-memory), ResultThresholdResolver, gateway realtime, dispatcher thông báo.
 *
 * Ngưỡng HGB nam (g/dL) giả lập theo DS-05: critical [0, 6.99] · medium [7, 12.99] · normal [13, 17.5].
 */
describe('Rule-based blood alert pipeline - Function 17 (supplement): detect -> alert -> realtime -> notification', () => {
    const HGB_PARAM = { parameterId: 'param-hgb', parameterCode: 'HGB', parameterName: 'Hemoglobin', dataType: 'numeric', unit: 'g/dL' };
    const HGB_ROWS = [
        { thresholdId: 'th-hgb-critical', parameterId: 'param-hgb', riskLevel: 'critical', rangeMin: 0, rangeMax: 6.99 },
        { thresholdId: 'th-hgb-medium', parameterId: 'param-hgb', riskLevel: 'medium', rangeMin: 7, rangeMax: 12.99 },
        { thresholdId: 'th-hgb-normal', parameterId: 'param-hgb', riskLevel: 'normal', rangeMin: 13, rangeMax: 17.5 },
    ];

    const makeHarness = (opts: { hgb: number; existingAlerts?: any[]; doctorUserId?: string | null }) => {
        const alertStore: any[] = [...(opts.existingAlerts ?? [])];

        const resultRecord = {
            resultId: 'res-001',
            resultedAt: new Date('2026-11-18T09:00:00Z'),
            values: [
                { resultValueId: 'rv-hgb', parameterId: 'param-hgb', valueNumeric: opts.hgb, valueBoolean: null, valueText: null, parameter: HGB_PARAM },
            ],
        };

        const tx = {
            resultValue: { update: jest.fn().mockResolvedValue({}) },
            resultValueAlert: {
                findMany: jest.fn(async ({ where }: any) =>
                    alertStore.filter((a) => a.resultValueId === where.resultValueId && where.status.in.includes(a.status)),
                ),
                create: jest.fn(async ({ data }: any) => {
                    const row = { alertId: `alert-${alertStore.length + 1}`, createdAt: new Date(), ...data };
                    alertStore.push(row);
                    return row;
                }),
                update: jest.fn(async ({ where, data }: any) => {
                    Object.assign(alertStore.find((a) => a.alertId === where.alertId), data);
                }),
                updateMany: jest.fn(async ({ where, data }: any) => {
                    const ids: string[] = where.alertId.in;
                    alertStore.filter((a) => ids.includes(a.alertId)).forEach((a) => Object.assign(a, data));
                    return { count: ids.length };
                }),
            },
        };
        const prisma = {
            diagnosticResult: { findUniqueOrThrow: jest.fn().mockResolvedValue(resultRecord) },
            $transaction: jest.fn(async (cb: any) => cb(tx)),
        };

        const thresholdResolver = {
            calculateAge: jest.fn().mockReturnValue(41),
            findApplicableRows: jest.fn().mockResolvedValue(HGB_ROWS),
        };
        const patientContextResolver = {
            resolve: jest.fn().mockResolvedValue({
                patientId: 'pat-001',
                encounterId: 'enc-001',
                doctorUserId: opts.doctorUserId === undefined ? 'doc-001' : opts.doctorUserId,
                dateOfBirth: new Date('1985-05-20'),
                gender: 'male',
            }),
        };

        const detector = new RuleBasedLabDetector(thresholdResolver as any);
        const orchestrator = new LabResultDetectionOrchestrator(prisma as any, detector, patientContextResolver as any);
        const gateway = { pushAlertUpdate: jest.fn() };
        const completion = { notifyForResult: jest.fn().mockResolvedValue(undefined) };
        const dispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) };
        const listener = new LabResultDetectionListener(orchestrator, gateway as any, completion as any, dispatcher as any);

        return { listener, orchestrator, prisma, tx, alertStore, gateway, completion, dispatcher };
    };

    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });

    // UTCID07: Normal - HGB 6.5 g/dL (critical) -> tạo ResultValueAlert 'active', push realtime, báo bác sĩ critical_value_alert
    it('UTCID07 [N]: should create an active critical alert, push it in real time and notify the doctor when HGB is critical', async () => {
        const h = makeHarness({ hgb: 6.5 });

        await h.listener.handleLabResultSubmitted(new LabResultSubmittedEvent('res-001', true));

        expect(h.tx.resultValue.update).toHaveBeenCalledWith({ where: { resultValueId: 'rv-hgb' }, data: { isAbnormal: true } });
        expect(h.alertStore).toHaveLength(1);
        expect(h.alertStore[0]).toMatchObject({
            resultValueId: 'rv-hgb',
            encounterId: 'enc-001',
            status: 'active',
            riskLevel: 'critical',
            thresholdId: 'th-hgb-critical',
        });
        expect(h.gateway.pushAlertUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ labResultId: 'res-001', encounterId: 'enc-001', totalValues: 1, abnormalCount: 1 }),
        );
        expect(h.gateway.pushAlertUpdate.mock.calls[0][0].results[0]).toMatchObject({ isAbnormal: true, riskLevel: 'critical' });
        expect(h.dispatcher.dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                recipient: { userId: 'doc-001' },
                notificationType: 'critical_value_alert',
                referenceType: 'result_value_alert',
                referenceId: 'alert-1',
            }),
            ['in_app'],
        );
        expect(h.completion.notifyForResult).toHaveBeenCalledWith('res-001'); // notifyCompletion = true
    });

    // UTCID08: Normal - HGB 15.0 g/dL trong khoảng bình thường -> không alert, không thông báo
    it('UTCID08 [N]: should raise no alert and send no notification when HGB is within the normal range', async () => {
        const h = makeHarness({ hgb: 15.0 });

        await h.listener.handleLabResultSubmitted(new LabResultSubmittedEvent('res-001', false));

        expect(h.tx.resultValue.update).toHaveBeenCalledWith({ where: { resultValueId: 'rv-hgb' }, data: { isAbnormal: false } });
        expect(h.tx.resultValueAlert.create).not.toHaveBeenCalled();
        expect(h.gateway.pushAlertUpdate).toHaveBeenCalledWith(expect.objectContaining({ totalValues: 1, abnormalCount: 0 }));
        expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
        expect(h.completion.notifyForResult).not.toHaveBeenCalled(); // notifyCompletion = false
    });

    // UTCID09: Abnormal (non-critical) - HGB 11.0 g/dL (medium) -> có alert + realtime nhưng KHÔNG gửi thông báo nguy kịch
    it('UTCID09 [A]: should raise a medium alert and push it in real time but not send a critical notification', async () => {
        const h = makeHarness({ hgb: 11.0 });

        await h.listener.handleLabResultSubmitted(new LabResultSubmittedEvent('res-001', false));

        expect(h.alertStore).toHaveLength(1);
        expect(h.alertStore[0]).toMatchObject({ status: 'active', riskLevel: 'medium' });
        expect(h.gateway.pushAlertUpdate).toHaveBeenCalledWith(expect.objectContaining({ abnormalCount: 1 }));
        expect(h.dispatcher.dispatch).not.toHaveBeenCalled(); // chỉ mức 'critical' mới notify bác sĩ
    });

    // UTCID10: Boundary - chạy lại detection khi đã có alert mở cùng mức nguy cơ -> idempotent, không tạo trùng, không thông báo lại
    it('UTCID10 [B]: should be idempotent when detection re-runs and an open alert with the same risk level already exists', async () => {
        const h = makeHarness({
            hgb: 6.5,
            existingAlerts: [{ alertId: 'alert-existing', resultValueId: 'rv-hgb', status: 'active', riskLevel: 'critical', createdAt: new Date() }],
        });

        await h.listener.handleLabResultSubmitted(new LabResultSubmittedEvent('res-001', false));

        expect(h.tx.resultValueAlert.create).not.toHaveBeenCalled();
        expect(h.alertStore).toHaveLength(1);
        expect(h.gateway.pushAlertUpdate).toHaveBeenCalledWith(expect.objectContaining({ abnormalCount: 1 })); // FE vẫn được cập nhật
        expect(h.dispatcher.dispatch).not.toHaveBeenCalled(); // alert không mới -> không bắn thông báo lần nữa
    });

    // UTCID11: Normal - kết quả được đính chính về giá trị bình thường -> alert đang mở chuyển 'resolved'
    it("UTCID11 [N]: should resolve the open alert when a corrected result is back within the normal range", async () => {
        const h = makeHarness({
            hgb: 15.0,
            existingAlerts: [{ alertId: 'alert-existing', resultValueId: 'rv-hgb', status: 'confirmed', riskLevel: 'critical', createdAt: new Date() }],
        });

        await h.listener.handleLabResultSubmitted(new LabResultSubmittedEvent('res-001', false));

        expect(h.tx.resultValueAlert.updateMany).toHaveBeenCalledWith({
            where: { alertId: { in: ['alert-existing'] } },
            data: { status: 'resolved' },
        });
        expect(h.alertStore[0].status).toBe('resolved');
        expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
    });

    // UTCID12: Boundary - encounter chưa có bác sĩ chỉ định: alert + realtime vẫn có, không có người nhận thông báo
    it('UTCID12 [B]: should still create and push the alert but notify nobody when the order has no assigned doctor', async () => {
        const h = makeHarness({ hgb: 6.5, doctorUserId: null });

        await h.listener.handleLabResultSubmitted(new LabResultSubmittedEvent('res-001', false));

        expect(h.alertStore).toHaveLength(1);
        expect(h.gateway.pushAlertUpdate).toHaveBeenCalledTimes(1);
        expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
    });

    // UTCID13: Abnormal - detection lỗi (DB) -> listener nuốt lỗi, không push, và thông báo hoàn tất VẪN được gửi
    it('UTCID13 [A]: should swallow a detection failure without pushing, and still send the completion notification', async () => {
        const h = makeHarness({ hgb: 6.5 });
        h.prisma.diagnosticResult.findUniqueOrThrow.mockRejectedValue(new Error('DB connection lost'));

        await expect(h.listener.handleLabResultSubmitted(new LabResultSubmittedEvent('res-001', true))).resolves.toBeUndefined();

        expect(h.gateway.pushAlertUpdate).not.toHaveBeenCalled();
        expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
        expect(h.completion.notifyForResult).toHaveBeenCalledWith('res-001');
    });
});
