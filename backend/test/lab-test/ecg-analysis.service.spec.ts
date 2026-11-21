import { BadRequestException, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { EcgAnalysisService } from '../../src/modules/lab-test/ecg-ai-analysis/ecg-analysis.service';
import { EcgAnalysisListener } from '../../src/modules/lab-test/ecg-ai-analysis/ecg-analysis.listener';
import { EcgAiError } from '../../src/modules/lab-test/ecg-ai-analysis/ecg-anomaly-provider.port';
import { ECG_ANALYSIS_QUEUED_EVENT, EcgAnalysisQueuedEvent } from '../../src/modules/lab-test/ecg-ai-analysis/events/ecg-analysis-queued.event';
import { EcgRecordingCompletedEvent } from '../../src/modules/lab-test/ecg-recording/events/ecg-recording-completed.event';

// @nestjs/event-emitter phát hành ESM — Jest (CJS) không nạp được; chỉ cần kiểu/decorator nên mock rỗng.
jest.mock('@nestjs/event-emitter', () => ({ EventEmitter2: class {}, OnEvent: () => () => undefined }));

/**
 * WF-03 · F-11 "ECG anomaly detection" — acceptance:
 *   "Uploaded ECG returns anomaly events in doctor workspace, AI failure never blocks outpatient process".
 *
 * Function 18 (Report5): EcgAnalysisService.enqueue(ecgRecordingId, mode, options)  -> UTCID01..07
 * Cùng Function 18 (mở rộng): EcgAnalysisService.run(analysisId) (batch inference nền) -> UTCID08..15
 *                              EcgAnalysisListener (trigger nền)                        -> UTCID16..19
 *
 * Lưu ý đối chiếu: sheet Function18 bản nháp mô tả enqueue theo message cũ ("Bản ghi ECG chưa hoàn tất thu thập dữ liệu",
 * "đã được phân tích"); source hiện tại dùng message/điều kiện khác (xem các expect bên dưới) nên test bám source.
 */
describe('EcgAnalysisService / EcgAnalysisListener - Function 18 (F-11)', () => {
    const RECORDING = {
        ecgRecordingId: 'rec-001',
        encounterId: 'enc-001',
        status: 'completed',
        signalFileUrl: 'ecg/enc-001/rec-001.csv',
        signalFormat: 'csv',
        sampleRateHz: 500,
        numLeads: 2,
        leadNames: ['I', 'II'],
        durationMs: 10000,
    };
    const MODEL = {
        modelVersionId: 'model-v1',
        modelName: 'ecg-anomaly',
        version: '1.0.0',
        status: 'active',
        taskType: 'ecg_anomaly_detection',
        defaultThreshold: 0.5,
        inputSpec: { windowMs: 2000, strideMs: 1000 },
    };
    const ABNORMAL_RESULT = {
        overallResult: 'abnormal',
        maxAnomalyScore: 0.93,
        thresholdUsed: 0.5,
        windowMs: 2000,
        strideMs: 1000,
        signalQuality: 0.9,
        summaryMetrics: { hrMean: 112 },
        inferenceLatencyMs: 850,
        anomalies: [
            { anomalyType: 'afib', score: 0.93, severity: 'high', startOffsetMs: 4000, endOffsetMs: 6000, affectedLeads: ['I', 'II'], heartRateBpm: 132, details: null },
            { anomalyType: 'pvc', score: 0.61, severity: 'medium', startOffsetMs: 1000, endOffsetMs: 1800, affectedLeads: ['II'], heartRateBpm: 96, details: null },
        ],
    };
    const NORMAL_RESULT = { ...ABNORMAL_RESULT, overallResult: 'normal', maxAnomalyScore: null, anomalies: [] };

    const makeHarness = () => {
        const tx = {
            ecgAiAnalysis: { update: jest.fn().mockResolvedValue({}), updateMany: jest.fn().mockResolvedValue({ count: 0 }), count: jest.fn().mockResolvedValue(0) },
            ecgAnomalyEvent: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
            ecgRecording: { update: jest.fn().mockResolvedValue({}) },
        };
        const prisma = {
            ecgRecording: {
                findUnique: jest.fn().mockResolvedValue(RECORDING),
                findUniqueOrThrow: jest.fn().mockResolvedValue({
                    encounterId: 'enc-001',
                    task: { orderItem: { order: { doctor: { userId: 'doc-001' } } } },
                }),
            },
            aiModelVersion: { findFirst: jest.fn().mockResolvedValue(MODEL) },
            ecgAiAnalysis: {
                findFirst: jest.fn().mockResolvedValue(null), // không có analysis queued/running
                create: jest.fn(async ({ data }: any) => ({ analysisId: 'ana-001', ...data })),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }), // claim queued -> running
                findUniqueOrThrow: jest.fn().mockResolvedValue({
                    analysisId: 'ana-001',
                    ecgRecording: RECORDING,
                    modelVersion: { modelName: 'ecg-anomaly', version: '1.0.0' },
                    thresholdUsed: 0.5,
                    windowMs: 2000,
                    strideMs: 1000,
                }),
            },
            $transaction: jest.fn(async (cb: any) => cb(tx)),
        };
        const actorRoleService = { assertActorRole: jest.fn().mockResolvedValue(undefined) };
        const eventEmitter = { emit: jest.fn() };
        const alertGateway = { pushEcgAlertUpdate: jest.fn() };
        const dispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) };
        const storage = { get: jest.fn().mockResolvedValue(Buffer.from('t,I,II\n0,0.1,0.2\n')) };
        const provider = { isConfigured: jest.fn().mockReturnValue(true), analyze: jest.fn().mockResolvedValue(ABNORMAL_RESULT) };

        const service = new EcgAnalysisService(
            prisma as any,
            actorRoleService as any,
            eventEmitter as any,
            alertGateway as any,
            dispatcher as any,
            storage as any,
            provider as any,
        );
        return { service, prisma, tx, eventEmitter, alertGateway, dispatcher, storage, provider };
    };

    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ------------------------------------------------------------------------------------------------------------
    describe('Function 18 - enqueue(ecgRecordingId, mode, options)', () => {
        // UTCID01: Normal - recording 'completed' + model active -> analysis 'queued', push realtime 'queued', phát event chạy nền
        it("UTCID01 [N]: should create a queued batch analysis with the active model, push 'queued' and emit the queued event", async () => {
            const h = makeHarness();

            const analysis: any = await h.service.enqueue('rec-001', 'batch');

            expect(h.prisma.ecgAiAnalysis.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    ecgRecordingId: 'rec-001',
                    modelVersionId: 'model-v1',
                    analysisMode: 'batch',
                    status: 'queued',
                    isCurrent: false,
                    thresholdUsed: 0.5,
                    windowMs: 2000,
                    strideMs: 1000,
                }),
            });
            expect(h.alertGateway.pushEcgAlertUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ analysisId: 'ana-001', encounterId: 'enc-001', status: 'queued', anomalyCount: 0 }),
            );
            expect(h.eventEmitter.emit).toHaveBeenCalledWith(ECG_ANALYSIS_QUEUED_EVENT, expect.objectContaining({ analysisId: 'ana-001' }));
            expect(analysis.status).toBe('queued');
        });

        // UTCID02: Normal - reanalysis với model 'candidate' chỉ định + ngưỡng tuỳ chọn
        it('UTCID02 [N]: should use the requested candidate model and threshold override for a reanalysis', async () => {
            const h = makeHarness();
            h.prisma.aiModelVersion.findFirst.mockResolvedValue({ ...MODEL, modelVersionId: 'model-v2', status: 'candidate' });

            const analysis: any = await h.service.enqueue('rec-001', 'reanalysis', { modelVersionId: 'model-v2', threshold: 0.8 });

            expect(h.prisma.aiModelVersion.findFirst).toHaveBeenCalledWith({
                where: { modelVersionId: 'model-v2', taskType: 'ecg_anomaly_detection', status: { in: ['active', 'candidate'] } },
            });
            expect(analysis).toMatchObject({ modelVersionId: 'model-v2', analysisMode: 'reanalysis', thresholdUsed: 0.8 });
        });

        // UTCID03: Abnormal - không tìm thấy bản ghi ECG
        it('UTCID03 [A]: should throw NotFoundException when the ECG recording does not exist', async () => {
            const h = makeHarness();
            h.prisma.ecgRecording.findUnique.mockResolvedValue(null);

            await expect(h.service.enqueue('rec-missing', 'batch')).rejects.toThrow(NotFoundException);

            expect(h.prisma.ecgAiAnalysis.create).not.toHaveBeenCalled();
        });

        // UTCID04: Abnormal - bản ghi chưa 'completed' (upload chưa xong)
        it("UTCID04 [A]: should throw BadRequestException when the recording is not 'completed' yet", async () => {
            const h = makeHarness();
            h.prisma.ecgRecording.findUnique.mockResolvedValue({ ...RECORDING, status: 'pending' });

            await expect(h.service.enqueue('rec-001', 'batch')).rejects.toThrow(BadRequestException);
            await expect(h.service.enqueue('rec-001', 'batch')).rejects.toThrow(/Chỉ phân tích được bản ghi 'completed'/);

            expect(h.prisma.ecgAiAnalysis.create).not.toHaveBeenCalled();
        });

        // UTCID05: Boundary - chưa có model AI 'active' -> trả null (KHÔNG lỗi): quy trình thủ công không bị chặn
        it("UTCID05 [B]: should return null without error or event when no 'active' AI model exists (manual flow is not blocked)", async () => {
            const h = makeHarness();
            h.prisma.aiModelVersion.findFirst.mockResolvedValue(null);

            await expect(h.service.enqueue('rec-001', 'batch')).resolves.toBeNull();

            expect(h.prisma.ecgAiAnalysis.create).not.toHaveBeenCalled();
            expect(h.eventEmitter.emit).not.toHaveBeenCalled();
        });

        // UTCID06: Abnormal - recording đang có analysis queued/running -> 409
        it('UTCID06 [A]: should throw ConflictException when the recording already has a queued/running analysis', async () => {
            const h = makeHarness();
            h.prisma.ecgAiAnalysis.findFirst.mockResolvedValue({ analysisId: 'ana-running' });

            await expect(h.service.enqueue('rec-001', 'batch')).rejects.toThrow(ConflictException);
            await expect(h.service.enqueue('rec-001', 'batch')).rejects.toThrow(/ana-running/);

            expect(h.prisma.ecgAiAnalysis.create).not.toHaveBeenCalled();
        });

        // UTCID07: Abnormal - modelVersionId chỉ định không hợp lệ (không active/candidate) -> 400, không im lặng bỏ qua
        it('UTCID07 [A]: should throw BadRequestException when the requested modelVersionId is not an active/candidate model', async () => {
            const h = makeHarness();
            h.prisma.aiModelVersion.findFirst.mockResolvedValue(null);

            await expect(h.service.enqueue('rec-001', 'reanalysis', { modelVersionId: 'model-retired' })).rejects.toThrow(BadRequestException);

            expect(h.prisma.ecgAiAnalysis.create).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------------------------------------------------
    describe('Function 18 - run(analysisId) - background batch inference', () => {
        const lastUpdateData = (h: ReturnType<typeof makeHarness>) => h.tx.ecgAiAnalysis.update.mock.calls[0][0].data;

        // UTCID08: Normal - AI phát hiện 2 đoạn bất thường -> lưu event (theo thời gian), isCurrent, push realtime, báo bác sĩ
        it('UTCID08 [N]: should persist anomaly events, take isCurrent, push realtime and notify the doctor on high severity', async () => {
            const h = makeHarness();

            await expect(h.service.run('ana-001')).resolves.toBeUndefined();

            expect(h.provider.analyze).toHaveBeenCalledWith(
                expect.objectContaining({
                    recordingId: 'rec-001',
                    fileName: 'rec-001.csv',
                    signalFormat: 'csv',
                    sampleRateHz: 500,
                    numLeads: 2,
                    model: { name: 'ecg-anomaly', version: '1.0.0' },
                    options: { threshold: 0.5, windowMs: 2000, strideMs: 1000 },
                }),
            );
            expect(lastUpdateData(h)).toMatchObject({ status: 'completed', overallResult: 'abnormal', anomalyCount: 2, maxAnomalyScore: 0.93, errorCode: null });
            const rows = h.tx.ecgAnomalyEvent.createMany.mock.calls[0][0].data;
            expect(rows.map((r: any) => r.anomalyType)).toEqual(['pvc', 'afib']); // sắp theo startOffsetMs
            expect(rows[0]).toMatchObject({ analysisId: 'ana-001', severity: 'medium', startOffsetMs: 1000, endOffsetMs: 1800 });
            expect(h.tx.ecgAiAnalysis.updateMany).toHaveBeenCalledWith({
                where: { ecgRecordingId: 'rec-001', analysisId: { not: 'ana-001' } },
                data: { isCurrent: false },
            });
            expect(h.tx.ecgAiAnalysis.update).toHaveBeenCalledWith({ where: { analysisId: 'ana-001' }, data: { isCurrent: true } });
            expect(h.alertGateway.pushEcgAlertUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ analysisId: 'ana-001', status: 'completed', overallResult: 'abnormal', anomalyCount: 2, maxSeverity: 'high' }),
            );
            expect(h.dispatcher.dispatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    recipient: { userId: 'doc-001' },
                    notificationType: 'ecg_anomaly_alert',
                    referenceType: 'ecg_ai_analysis',
                    referenceId: 'ana-001',
                }),
                ['in_app'],
            );
        });

        // UTCID09: Normal - ECG bình thường -> completed, không tạo event, không thông báo
        it('UTCID09 [N]: should complete with no anomaly events and no doctor notification when the ECG is normal', async () => {
            const h = makeHarness();
            h.provider.analyze.mockResolvedValue(NORMAL_RESULT);

            await h.service.run('ana-001');

            expect(lastUpdateData(h)).toMatchObject({ status: 'completed', overallResult: 'normal', anomalyCount: 0 });
            expect(h.tx.ecgAnomalyEvent.createMany).not.toHaveBeenCalled();
            expect(h.alertGateway.pushEcgAlertUpdate).toHaveBeenCalledWith(
                expect.objectContaining({ status: 'completed', anomalyCount: 0, maxSeverity: null }),
            );
            expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
        });

        // UTCID10: Abnormal - dịch vụ AI chưa cấu hình -> 'skipped' (không phải lỗi), không đọc tệp, run() không ném
        it("UTCID10 [A]: should mark the analysis 'skipped' (AI_NOT_CONFIGURED) without reading the signal or throwing", async () => {
            const h = makeHarness();
            h.provider.isConfigured.mockReturnValue(false);

            await expect(h.service.run('ana-001')).resolves.toBeUndefined();

            expect(h.tx.ecgAiAnalysis.update.mock.calls[0][0].data).toMatchObject({ status: 'skipped', errorCode: 'AI_NOT_CONFIGURED' });
            expect(h.storage.get).not.toHaveBeenCalled();
            expect(h.provider.analyze).not.toHaveBeenCalled();
            expect(h.tx.ecgAnomalyEvent.createMany).not.toHaveBeenCalled();
            expect(h.tx.ecgAiAnalysis.update).toHaveBeenCalledWith({ where: { analysisId: 'ana-001' }, data: { isCurrent: true } }); // UI báo "AI unavailable"
            expect(h.alertGateway.pushEcgAlertUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'skipped', errorCode: 'AI_NOT_CONFIGURED' }));
        });

        // UTCID11: Abnormal - DS-06: AI timeout/không khả dụng -> 'failed', không tạo event/alert, run() KHÔNG ném (luồng ngoại trú tiếp tục)
        it("UTCID11 [A]: should mark the analysis 'failed' with no events or alerts and never throw when the AI service times out", async () => {
            const h = makeHarness();
            h.provider.analyze.mockRejectedValue(new EcgAiError('AI_TIMEOUT', 'Hết thời gian chờ dịch vụ AI'));

            await expect(h.service.run('ana-001')).resolves.toBeUndefined();

            expect(h.tx.ecgAiAnalysis.update.mock.calls[0][0].data).toMatchObject({ status: 'failed', errorCode: 'AI_TIMEOUT' });
            expect(h.tx.ecgAnomalyEvent.createMany).not.toHaveBeenCalled();
            expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
            expect(h.alertGateway.pushEcgAlertUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', errorCode: 'AI_TIMEOUT' }));
        });

        // UTCID12: Abnormal - MinIO không đọc được tệp tín hiệu -> 'failed' SIGNAL_READ_FAILED, không gọi AI
        it("UTCID12 [A]: should mark the analysis 'failed' (SIGNAL_READ_FAILED) and skip the AI call when the signal file cannot be read", async () => {
            const h = makeHarness();
            h.storage.get.mockRejectedValue(new Error('MinIO unavailable'));

            await expect(h.service.run('ana-001')).resolves.toBeUndefined();

            expect(h.tx.ecgAiAnalysis.update.mock.calls[0][0].data).toMatchObject({ status: 'failed', errorCode: 'SIGNAL_READ_FAILED' });
            expect(h.tx.ecgAiAnalysis.update.mock.calls[0][0].data.errorMessage).toContain('MinIO unavailable');
            expect(h.provider.analyze).not.toHaveBeenCalled();
        });

        // UTCID13: Boundary - worker khác đã nhận analysis (claim count = 0) -> thoát sớm, không chạy AI lần 2
        it('UTCID13 [B]: should return immediately without running the AI when the analysis was already claimed by another worker', async () => {
            const h = makeHarness();
            h.prisma.ecgAiAnalysis.updateMany.mockResolvedValue({ count: 0 });

            await expect(h.service.run('ana-001')).resolves.toBeUndefined();

            expect(h.prisma.ecgAiAnalysis.findUniqueOrThrow).not.toHaveBeenCalled();
            expect(h.provider.analyze).not.toHaveBeenCalled();
            expect(h.prisma.$transaction).not.toHaveBeenCalled();
        });

        // UTCID14: Boundary - mức cao nhất 'medium' (< ngưỡng 'high') -> lưu event nhưng KHÔNG gửi ecg_anomaly_alert
        it("UTCID14 [B]: should store the event but not notify the doctor when the highest severity is below 'high'", async () => {
            const h = makeHarness();
            h.provider.analyze.mockResolvedValue({ ...ABNORMAL_RESULT, anomalies: [ABNORMAL_RESULT.anomalies[1]] });

            await h.service.run('ana-001');

            expect(h.tx.ecgAnomalyEvent.createMany.mock.calls[0][0].data).toHaveLength(1);
            expect(h.alertGateway.pushEcgAlertUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed', maxSeverity: 'medium' }));
            expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
        });

        // UTCID15: Abnormal - gửi thông báo bác sĩ lỗi -> analysis đã lưu vẫn 'completed' (không bị đánh dấu failed)
        it('UTCID15 [A]: should keep the analysis completed when the doctor notification fails', async () => {
            const h = makeHarness();
            h.dispatcher.dispatch.mockRejectedValue(new Error('notification channel down'));

            await expect(h.service.run('ana-001')).resolves.toBeUndefined();

            expect(h.tx.ecgAiAnalysis.update.mock.calls[0][0].data).toMatchObject({ status: 'completed' });
            const markedFailed = h.tx.ecgAiAnalysis.update.mock.calls.some((c: any[]) => c[0].data?.status === 'failed');
            expect(markedFailed).toBe(false);
            expect(h.tx.ecgAnomalyEvent.createMany).toHaveBeenCalledTimes(1);
        });
    });

    // ------------------------------------------------------------------------------------------------------------
    describe('Function 18 - EcgAnalysisListener - background trigger', () => {
        const makeListener = () => {
            const analysisService = { enqueue: jest.fn().mockResolvedValue({ analysisId: 'ana-001' }), run: jest.fn().mockResolvedValue(undefined) };
            return { listener: new EcgAnalysisListener(analysisService as any), analysisService };
        };

        // UTCID16: Normal - upload xong với autoAnalyze = true -> xếp hàng phân tích 'batch'
        it("UTCID16 [N]: should enqueue a 'batch' analysis when a recording completes with autoAnalyze = true", async () => {
            const { listener, analysisService } = makeListener();

            await listener.onRecordingCompleted(new EcgRecordingCompletedEvent('rec-001', true));

            expect(analysisService.enqueue).toHaveBeenCalledWith('rec-001', 'batch');
        });

        // UTCID17: Boundary - autoAnalyze = false -> không xếp hàng
        it('UTCID17 [B]: should not enqueue anything when autoAnalyze = false', async () => {
            const { listener, analysisService } = makeListener();

            await listener.onRecordingCompleted(new EcgRecordingCompletedEvent('rec-001', false));

            expect(analysisService.enqueue).not.toHaveBeenCalled();
        });

        // UTCID18: Abnormal - enqueue lỗi (vd. 409) -> listener nuốt lỗi, không làm hỏng luồng upload
        it('UTCID18 [A]: should swallow an enqueue failure so the upload flow is never affected', async () => {
            const { listener, analysisService } = makeListener();
            analysisService.enqueue.mockRejectedValue(new ConflictException('đang có phân tích chưa xong'));

            await expect(listener.onRecordingCompleted(new EcgRecordingCompletedEvent('rec-001', true))).resolves.toBeUndefined();
        });

        // UTCID19: Normal + Abnormal - event queued -> run(); lỗi bất ngờ trong run() cũng bị nuốt
        it('UTCID19 [A]: should run the queued analysis and swallow any unexpected error thrown by run()', async () => {
            const { listener, analysisService } = makeListener();

            await listener.onAnalysisQueued(new EcgAnalysisQueuedEvent('ana-001'));
            expect(analysisService.run).toHaveBeenCalledWith('ana-001');

            analysisService.run.mockRejectedValue(new Error('unexpected'));
            await expect(listener.onAnalysisQueued(new EcgAnalysisQueuedEvent('ana-002'))).resolves.toBeUndefined();
        });
    });
});
