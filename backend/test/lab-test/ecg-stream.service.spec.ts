import { EcgStreamError, EcgStreamService } from '../../src/modules/lab-test/ecg-stream/ecg-stream.service';
import { EcgAiError } from '../../src/modules/lab-test/ecg-ai-analysis/ecg-anomaly-provider.port';

const csv = (rows: number) => Buffer.from('I,II\n' + Array.from({ length: rows }, (_, i) => `${i},${i * 10}`).join('\n') + '\n');
const aiResult = (anomalies: { startOffsetMs: number; endOffsetMs: number }[], overallResult = 'abnormal') => ({
    overallResult,
    anomalies: anomalies.map((a) => ({ ...a, anomalyType: null, score: 0.9, severity: 'high', affectedLeads: [], heartRateBpm: null, details: null })),
});

describe('EcgStreamService.prepare', () => {
    const prisma = { ecgRecording: { findUnique: jest.fn() }, ecgAiAnalysis: { findFirst: jest.fn() }, aiModelVersion: { findFirst: jest.fn() } };
    const storage = { get: jest.fn() };
    const provider = { isConfigured: jest.fn(), analyze: jest.fn() };
    const datasets = { load: jest.fn(), list: jest.fn() };
    const service = new EcgStreamService(prisma as any, storage as any, provider as any, datasets as any);
    const prevLeads = process.env.ECG_REQUIRED_LEADS;

    const rec = (over: Record<string, unknown> = {}) => ({
        status: 'completed', signalFileUrl: 'ecg/e/r.csv', signalFormat: 'csv', sampleRateHz: 500, numLeads: 2, leadNames: ['I', 'II'], ...over,
    });
    const recording = (extra: Record<string, unknown> = {}) => ({ source: { kind: 'recording' as const, recordingId: 'r' }, withAnomaly: false, ...extra });

    beforeEach(() => {
        jest.resetAllMocks();
        delete process.env.ECG_REQUIRED_LEADS; // mặc định của config = 2
        prisma.ecgRecording.findUnique.mockResolvedValue(rec());
        storage.get.mockResolvedValue(csv(1000));
        provider.isConfigured.mockReturnValue(true);
        prisma.aiModelVersion.findFirst.mockResolvedValue({ modelName: 'ecg-tcn-vae-diffusion', version: '1.0.0' });
    });
    afterAll(() => {
        if (prevLeads === undefined) delete process.env.ECG_REQUIRED_LEADS;
        else process.env.ECG_REQUIRED_LEADS = prevLeads;
    });

    const fail = async (p: Promise<unknown>, code: string) => {
        await expect(p).rejects.toBeInstanceOf(EcgStreamError);
        await expect(p).rejects.toMatchObject({ code });
    };

    describe('nguồn recording (luồng cũ)', () => {
        it('API [1]: mặc định lead II, không flags, không đụng bảng analysis / AI', async () => {
            const r = await service.prepare(recording());
            expect(r).toMatchObject({ source: 'recording', sourceName: 'r', recordingId: 'r', lead: 'II', sampleRateHz: 500, totalPoints: 1000, durationMs: 2000, startIndex: 0 });
            expect(Array.from(r.samples.subarray(0, 3))).toEqual([0, 10, 20]);
            expect(r.flags).toBeUndefined();
            expect(prisma.ecgAiAnalysis.findFirst).not.toHaveBeenCalled();
            expect(provider.analyze).not.toHaveBeenCalled();
        });

        it('chọn lead theo tên/chỉ số; lead lạ -> LEAD_NOT_FOUND', async () => {
            expect((await service.prepare(recording({ lead: 'i' }))).lead).toBe('I');
            expect((await service.prepare(recording({ lead: 1 }))).lead).toBe('II');
            expect((await service.prepare(recording({ lead: '0' }))).lead).toBe('I');
            await fail(service.prepare(recording({ lead: 'V9' })), 'LEAD_NOT_FOUND');
            await fail(service.prepare(recording({ lead: 5 })), 'LEAD_NOT_FOUND');
        });

        it('startMs đổi thành startIndex theo sampleRate', async () => {
            expect((await service.prepare(recording({ startMs: 100 }))).startIndex).toBe(50);
        });

        it('API [2]: dựng flags từ sự kiện của analysis isCurrent+completed, KHÔNG gọi AI', async () => {
            prisma.ecgAiAnalysis.findFirst.mockResolvedValue({ analysisId: 'a1', overallResult: 'abnormal', events: [{ startOffsetMs: 10, endOffsetMs: 20 }] });
            const r = await service.prepare(recording({ withAnomaly: true }));
            expect(prisma.ecgAiAnalysis.findFirst.mock.calls[0][0].where).toEqual({ ecgRecordingId: 'r', isCurrent: true, status: 'completed' });
            expect(r).toMatchObject({ analysisId: 'a1', overallResult: 'abnormal', anomalyPointCount: 6 }); // mẫu 5..10
            expect([r.flags![4], r.flags![5], r.flags![10], r.flags![11]]).toEqual([0, 1, 1, 0]);
            expect(provider.analyze).not.toHaveBeenCalled();
        });

        it('API [2] với analysisId cụ thể lọc đúng recording + completed', async () => {
            prisma.ecgAiAnalysis.findFirst.mockResolvedValue({ analysisId: 'a2', overallResult: 'normal', events: [] });
            const r = await service.prepare({ source: { kind: 'recording', recordingId: 'r', analysisId: 'a2' }, withAnomaly: true });
            expect(prisma.ecgAiAnalysis.findFirst.mock.calls[0][0].where).toEqual({ analysisId: 'a2', ecgRecordingId: 'r', status: 'completed' });
            expect(r.anomalyPointCount).toBe(0);
        });

        it('API [2] chưa có analysis hoàn tất -> ANALYSIS_NOT_READY và KHÔNG tải tệp', async () => {
            prisma.ecgAiAnalysis.findFirst.mockResolvedValue(null);
            await fail(service.prepare(recording({ withAnomaly: true })), 'ANALYSIS_NOT_READY');
            expect(storage.get).not.toHaveBeenCalled();
        });

        it('lỗi bản ghi: không tồn tại / chưa completed / không có tệp / định dạng không stream được', async () => {
            prisma.ecgRecording.findUnique.mockResolvedValue(null);
            await fail(service.prepare(recording()), 'RECORDING_NOT_FOUND');
            prisma.ecgRecording.findUnique.mockResolvedValue(rec({ status: 'cancelled' }));
            await fail(service.prepare(recording()), 'RECORDING_NOT_READY');
            prisma.ecgRecording.findUnique.mockResolvedValue(rec({ signalFileUrl: null }));
            await fail(service.prepare(recording()), 'RECORDING_NOT_READY');
            prisma.ecgRecording.findUnique.mockResolvedValue(rec({ signalFormat: 'wfdb' }));
            await fail(service.prepare(recording()), 'SIGNAL_FORMAT_NOT_STREAMABLE');
        });

        it('lỗi đọc storage / parse tệp hỏng', async () => {
            storage.get.mockRejectedValue(new Error('minio down'));
            await fail(service.prepare(recording()), 'SIGNAL_LOAD_FAILED');
            storage.get.mockResolvedValue(Buffer.from('I,II\n'));
            await fail(service.prepare(recording()), 'SIGNAL_PARSE_FAILED');
        });
    });

    describe('nguồn upload', () => {
        const upload = (extra: Record<string, unknown> = {}, src: Record<string, unknown> = {}) => ({
            source: { kind: 'upload' as const, data: csv(300), fileName: 'my.csv', sampleRateHz: 100, ...src },
            withAnomaly: false,
            ...extra,
        });

        it('API [1] csv: phát theo sampleRate người dùng gửi, không đụng DB/AI/storage', async () => {
            const r = await service.prepare(upload());
            expect(r).toMatchObject({ source: 'upload', sourceName: 'my.csv', lead: 'II', sampleRateHz: 100, totalPoints: 300, durationMs: 3000 });
            expect(r).not.toHaveProperty('recordingId');
            expect(prisma.ecgRecording.findUnique).not.toHaveBeenCalled();
            expect(storage.get).not.toHaveBeenCalled();
            expect(provider.analyze).not.toHaveBeenCalled();
        });

        it('npy 2 kênh không có header -> tên lead mặc định I, II; leadNames do người dùng gửi được ưu tiên', async () => {
            const npyBuf = makeNpy([1, 10, 2, 20, 3, 30], [3, 2]);
            const a = await service.prepare(upload({}, { data: npyBuf, fileName: 'x.NPY' }));
            expect(a.lead).toBe('II');
            expect(Array.from(a.samples)).toEqual([10, 20, 30]);
            const b = await service.prepare(upload({ lead: 'MLII' }, { data: npyBuf, fileName: 'x.npy', leadNames: ['V1', 'MLII'] }));
            expect(b.lead).toBe('MLII');
        });

        it('đuôi tệp không phải .npy/.csv -> UNSUPPORTED_FILE_TYPE', async () => {
            await fail(service.prepare(upload({}, { fileName: 'a.edf' })), 'UNSUPPORTED_FILE_TYPE');
            await fail(service.prepare(upload({}, { fileName: 'noext' })), 'UNSUPPORTED_FILE_TYPE');
        });

        it('tệp hỏng -> SIGNAL_PARSE_FAILED', async () => {
            await fail(service.prepare(upload({}, { data: Buffer.from('rác'), fileName: 'a.npy' })), 'SIGNAL_PARSE_FAILED');
        });

        it('API [2]: gọi AI đúng hợp đồng (raw bytes + format + model active) và gắn cờ từ các đoạn AI trả về', async () => {
            provider.analyze.mockResolvedValue(aiResult([{ startOffsetMs: 100, endOffsetMs: 200 }]));
            const data = csv(300);
            const r = await service.prepare(upload({ withAnomaly: true }, { data }));
            const input = provider.analyze.mock.calls[0][0];
            expect(input).toMatchObject({
                signal: data, signalFormat: 'csv', fileName: 'my.csv', sampleRateHz: 100, numLeads: 2, leadNames: ['I', 'II'], durationMs: 3000,
                model: { name: 'ecg-tcn-vae-diffusion', version: '1.0.0' },
            });
            expect(input.recordingId).toMatch(/^adhoc-/);
            // 100Hz = 10ms/mẫu; [100,200]ms -> mẫu 10..20
            expect(r.anomalyPointCount).toBe(11);
            expect([r.flags![9], r.flags![10], r.flags![20], r.flags![21]]).toEqual([0, 1, 1, 0]);
            expect(r.overallResult).toBe('abnormal');
            expect(r).not.toHaveProperty('analysisId');
        });

        it('upload không cache: mỗi lần gọi lại AI', async () => {
            provider.analyze.mockResolvedValue(aiResult([]));
            await service.prepare(upload({ withAnomaly: true }));
            await service.prepare(upload({ withAnomaly: true }));
            expect(provider.analyze).toHaveBeenCalledTimes(2);
        });

        it('API [2]: số lead khác yêu cầu của model -> LEAD_COUNT_MISMATCH, không gọi AI', async () => {
            await fail(service.prepare(upload({ withAnomaly: true }, { data: Buffer.from('a\n1\n2\n3\n') })), 'LEAD_COUNT_MISMATCH');
            expect(provider.analyze).not.toHaveBeenCalled();
        });

        it('API [2]: AI chưa cấu hình / chưa có model active', async () => {
            provider.isConfigured.mockReturnValue(false);
            await fail(service.prepare(upload({ withAnomaly: true })), 'AI_NOT_CONFIGURED');
            provider.isConfigured.mockReturnValue(true);
            prisma.aiModelVersion.findFirst.mockResolvedValue(null);
            await fail(service.prepare(upload({ withAnomaly: true })), 'AI_MODEL_NOT_FOUND');
        });

        it('API [2]: lỗi AI giữ mã, thông điệp sạch (không lộ host nội bộ)', async () => {
            provider.analyze.mockRejectedValue(new EcgAiError('AI_UNAVAILABLE', 'Không kết nối được dịch vụ AI: connect ECONNREFUSED 10.0.0.5:8000', true));
            const p = service.prepare(upload({ withAnomaly: true }));
            await fail(p, 'AI_UNAVAILABLE');
            await expect(p).rejects.not.toThrow(/10\.0\.0\.5/);
            provider.analyze.mockRejectedValue(new EcgAiError('AI_HTTP_500', 'body: traceback secret', false));
            const q = service.prepare(upload({ withAnomaly: true }));
            await fail(q, 'AI_HTTP_500');
            await expect(q).rejects.not.toThrow(/secret/);
        });
    });

    describe('nguồn dataset ECG_A..F', () => {
        const loaded = (version = 'v1') => ({ name: 'ECG_A', buffer: makeNpy(Array.from({ length: 400 }, (_, i) => i), [200, 2], '<f8'), format: 'npy', fileName: 'ECG_A.npy', sampleRateHz: 100, version });
        const ds = (extra: Record<string, unknown> = {}) => ({ source: { kind: 'dataset' as const, name: 'ECG_A' as const }, withAnomaly: false, ...extra });

        it('API [1]: đọc từ catalog, lead mặc định II, sampleRate lấy từ dataset', async () => {
            datasets.load.mockResolvedValue(loaded());
            const r = await service.prepare(ds());
            expect(datasets.load).toHaveBeenCalledWith('ECG_A');
            expect(r).toMatchObject({ source: 'dataset', sourceName: 'ECG_A', lead: 'II', sampleRateHz: 100, totalPoints: 200, durationMs: 2000 });
            expect(Array.from(r.samples.subarray(0, 3))).toEqual([1, 3, 5]); // cột 2 của ma trận [mẫu][lead]
        });

        it('dataset chưa cài -> lỗi của catalog được chuyển nguyên', async () => {
            datasets.load.mockRejectedValue(new EcgStreamError('DATASET_NOT_AVAILABLE', 'Dataset ECG_B chưa được cài trên server.'));
            await fail(service.prepare(ds()), 'DATASET_NOT_AVAILABLE');
        });

        it('API [2]: gọi AI 1 lần rồi cache theo (dataset, version tệp, model); đổi version hoặc model thì gọi lại', async () => {
            datasets.load.mockResolvedValue(loaded('v1'));
            provider.analyze.mockResolvedValue(aiResult([{ startOffsetMs: 100, endOffsetMs: 200 }]));
            const a = await service.prepare(ds({ withAnomaly: true }));
            const b = await service.prepare(ds({ withAnomaly: true }));
            expect(provider.analyze).toHaveBeenCalledTimes(1);
            expect(provider.analyze.mock.calls[0][0]).toMatchObject({ signalFormat: 'npy', fileName: 'ECG_A.npy', numLeads: 2, leadNames: ['I', 'II'], recordingId: 'adhoc-ECG_A' });
            expect(Array.from(b.flags!)).toEqual(Array.from(a.flags!));
            expect(a.anomalyPointCount).toBe(11);

            datasets.load.mockResolvedValue(loaded('v2')); // tệp đổi
            await service.prepare(ds({ withAnomaly: true }));
            expect(provider.analyze).toHaveBeenCalledTimes(2);
            prisma.aiModelVersion.findFirst.mockResolvedValue({ modelName: 'ecg-tcn-vae-diffusion', version: '1.1.0' }); // model đổi
            await service.prepare(ds({ withAnomaly: true }));
            expect(provider.analyze).toHaveBeenCalledTimes(3);
        });

        it('lỗi AI không bị cache', async () => {
            datasets.load.mockResolvedValue(loaded('v9'));
            provider.analyze.mockRejectedValueOnce(new EcgAiError('AI_TIMEOUT', 'timeout', true)).mockResolvedValueOnce(aiResult([]));
            await fail(service.prepare(ds({ withAnomaly: true })), 'AI_TIMEOUT');
            await expect(service.prepare(ds({ withAnomaly: true }))).resolves.toMatchObject({ anomalyPointCount: 0 });
        });
    });
});

/** Dựng .npy v1 little-endian. */
function makeNpy(values: number[], shape: number[], descr = '<f4'): Buffer {
    const shapeStr = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(', ')})`;
    let header = `{'descr': '${descr}', 'fortran_order': False, 'shape': ${shapeStr}, }`;
    header = header + ' '.repeat(64 - ((10 + header.length + 1) % 64)) + '\n';
    const size = descr.endsWith('f8') ? 8 : 4;
    const body = Buffer.alloc(values.length * size);
    values.forEach((v, i) => (size === 8 ? body.writeDoubleLE(v, i * 8) : body.writeFloatLE(v, i * 4)));
    const head = Buffer.alloc(10);
    Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]).copy(head);
    head.writeUInt16LE(header.length, 8);
    return Buffer.concat([head, Buffer.from(header, 'latin1'), body]);
}
