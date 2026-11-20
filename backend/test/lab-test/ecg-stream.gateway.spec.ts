import { EcgStreamGateway } from '../../src/modules/lab-test/ecg-stream/ecg-stream.gateway';
import { EcgStreamError } from '../../src/modules/lab-test/ecg-stream/ecg-stream.error';

const makeClient = (auth: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    ({ id: 'c1', data: {} as Record<string, unknown>, disconnected: false, handshake: { auth, headers }, emit: jest.fn(), disconnect: jest.fn() }) as any;

const prepared = (withFlags: boolean, over: Record<string, unknown> = {}) => ({
    source: 'recording',
    sourceName: 'rec-1',
    recordingId: 'rec-1',
    lead: 'II',
    sampleRateHz: 100,
    samples: Float32Array.from([1, 2, 3, 4, 5]),
    flags: withFlags ? Uint8Array.from([0, 1, 1, 0, 0]) : undefined,
    analysisId: withFlags ? 'an-1' : undefined,
    overallResult: withFlags ? 'abnormal' : undefined,
    anomalyPointCount: withFlags ? 2 : undefined,
    totalPoints: 5,
    durationMs: 50,
    startIndex: 0,
    ...over,
});

describe('EcgStreamGateway (/ecg-stream)', () => {
    const jwt = { verifyAsync: jest.fn() };
    const roles = { assertActorRole: jest.fn() };
    const streams = { prepare: jest.fn(), listDatasets: jest.fn() };
    let gateway: EcgStreamGateway;
    const prev = { auth: process.env.LAB_ALERT_REQUIRE_AUTH, max: process.env.ECG_STREAM_MAX_UPLOAD_BYTES };

    beforeEach(() => {
        jest.resetAllMocks();
        jest.useFakeTimers();
        delete process.env.LAB_ALERT_REQUIRE_AUTH;
        delete process.env.ECG_STREAM_MAX_UPLOAD_BYTES;
        gateway = new EcgStreamGateway(jwt as any, roles as any, streams as any);
    });
    afterEach(() => jest.useRealTimers());
    afterAll(() => {
        for (const [k, v] of [['LAB_ALERT_REQUIRE_AUTH', prev.auth], ['ECG_STREAM_MAX_UPLOAD_BYTES', prev.max]] as const) {
            if (v === undefined) delete process.env[k];
            else process.env[k] = v;
        }
    });

    const authed = () => {
        roles.assertActorRole.mockResolvedValue('DOCTOR');
        const c = makeClient();
        c.data.userId = 'u1';
        return c;
    };
    const up = (extra: Record<string, unknown> = {}) => ({ file: Buffer.from('1,2\n3,4\n'), fileName: 'ecg.csv', sampleRateHz: 100, ...extra });

    describe('xác thực / phân quyền', () => {
        it('từ chối kết nối thiếu token hoặc token sai', async () => {
            const a = makeClient();
            await gateway.handleConnection(a);
            expect(a.disconnect).toHaveBeenCalledWith(true);
            jwt.verifyAsync.mockRejectedValue(new Error('expired'));
            const b = makeClient({ token: 'bad' });
            await gateway.handleConnection(b);
            expect(b.disconnect).toHaveBeenCalled();
        });

        it('chấp nhận token hợp lệ (auth.token hoặc header)', async () => {
            jwt.verifyAsync.mockResolvedValue({ sub: 'u1' });
            const a = makeClient({ token: 'Bearer abc' });
            await gateway.handleConnection(a);
            expect(jwt.verifyAsync).toHaveBeenCalledWith('abc');
            expect(a.data.userId).toBe('u1');
            const b = makeClient({}, { authorization: 'Bearer xyz' });
            await gateway.handleConnection(b);
            expect(b.disconnect).not.toHaveBeenCalled();
        });

        it('forbidden khi chưa xác thực hoặc sai vai trò (cả 2 API và list); không nạp dữ liệu', async () => {
            await expect(gateway.handleStream(makeClient(), { recordingId: 'r' })).resolves.toEqual({ status: 'forbidden' });
            await expect(gateway.handleListDatasets(makeClient())).resolves.toEqual({ status: 'forbidden' });
            roles.assertActorRole.mockRejectedValue(new Error('no'));
            const c = makeClient();
            c.data.userId = 'u1';
            await expect(gateway.handleStreamAnomaly(c, { dataset: 'ECG_A' })).resolves.toEqual({ status: 'forbidden' });
            await expect(gateway.handleStream(c, up())).resolves.toEqual({ status: 'forbidden' });
            expect(streams.prepare).not.toHaveBeenCalled();
        });

        it('LAB_ALERT_REQUIRE_AUTH=false: bỏ qua xác thực (dev)', async () => {
            process.env.LAB_ALERT_REQUIRE_AUTH = 'false';
            streams.prepare.mockResolvedValue(prepared(false));
            const c = makeClient();
            await gateway.handleConnection(c);
            await expect(gateway.handleStream(c, { recordingId: 'rec-1' })).resolves.toMatchObject({ status: 'streaming' });
            gateway.handleDisconnect(c);
        });
    });

    describe('validate nguồn và đầu vào', () => {
        it.each([
            ['không có nguồn', {}],
            ['hai nguồn: file + dataset', up({ dataset: 'ECG_A' })],
            ['hai nguồn: dataset + recordingId', { dataset: 'ECG_A', recordingId: 'r' }],
            ['ba nguồn', up({ dataset: 'ECG_A', recordingId: 'r' })],
            ['dataset ngoài danh mục', { dataset: 'ECG_G' }],
            ['dataset path traversal', { dataset: '../ECG_A' }],
            ['recordingId rỗng', { recordingId: '' }],
            ['recordingId quá dài', { recordingId: 'x'.repeat(65) }],
            ['file không phải nhị phân', up({ file: 'chuỗi' })],
            ['file rỗng', up({ file: Buffer.alloc(0) })],
            ['thiếu fileName', up({ fileName: undefined })],
            ['fileName rỗng', up({ fileName: '' })],
            ['thiếu sampleRateHz', up({ sampleRateHz: undefined })],
            ['sampleRateHz thấp', up({ sampleRateHz: 10 })],
            ['sampleRateHz cao', up({ sampleRateHz: 99999 })],
            ['sampleRateHz không nguyên', up({ sampleRateHz: 100.5 })],
            ['leadNames không phải mảng', up({ leadNames: 'I,II' })],
            ['leadNames chứa số', up({ leadNames: ['I', 2] })],
            ['leadNames quá nhiều', up({ leadNames: Array(13).fill('I') })],
            ['speed = 0', { recordingId: 'r', speed: 0 }],
            ['speed quá lớn', { dataset: 'ECG_A', speed: 99 }],
            ['speed không phải số', { dataset: 'ECG_A', speed: 'fast' }],
            ['startMs âm', { dataset: 'ECG_A', startMs: -1 }],
            ['lead là object', { dataset: 'ECG_A', lead: { a: 1 } }],
            ['analysisId rỗng', { recordingId: 'r', analysisId: '' }],
        ])('INVALID_REQUEST: %s', async (_name, body) => {
            for (const call of [gateway.handleStream, gateway.handleStreamAnomaly]) {
                const r = await call.call(gateway, authed(), body as any);
                expect(r).toMatchObject({ status: 'error', code: 'INVALID_REQUEST' });
            }
            expect(streams.prepare).not.toHaveBeenCalled();
        });

        it('đuôi tệp sai -> UNSUPPORTED_FILE_TYPE; tệp quá lớn -> FILE_TOO_LARGE (theo ECG_STREAM_MAX_UPLOAD_BYTES)', async () => {
            await expect(gateway.handleStream(authed(), up({ fileName: 'a.edf' }))).resolves.toMatchObject({ status: 'error', code: 'UNSUPPORTED_FILE_TYPE' });
            await expect(gateway.handleStream(authed(), up({ fileName: 'a.json' }))).resolves.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
            process.env.ECG_STREAM_MAX_UPLOAD_BYTES = '4';
            await expect(gateway.handleStream(authed(), up())).resolves.toMatchObject({ status: 'error', code: 'FILE_TOO_LARGE' });
            expect(streams.prepare).not.toHaveBeenCalled();
        });

        it('body undefined cũng không ném lỗi', async () => {
            await expect(gateway.handleStream(authed(), undefined as any)).resolves.toMatchObject({ status: 'error' });
        });
    });

    describe('chuyển nguồn xuống service', () => {
        beforeEach(() => streams.prepare.mockResolvedValue(prepared(false)));
        const sourceOf = () => streams.prepare.mock.calls[0][0];

        it('file upload (Buffer): kind=upload kèm fileName, sampleRateHz, leadNames', async () => {
            const file = Buffer.from('a,b\n1,2\n');
            await gateway.handleStream(authed(), up({ file, fileName: 'x.NPY', sampleRateHz: 250, leadNames: ['I', 'II'], lead: 'I', speed: 2, startMs: 500 }));
            expect(sourceOf()).toEqual({
                source: { kind: 'upload', data: file, fileName: 'x.NPY', sampleRateHz: 250, leadNames: ['I', 'II'] },
                lead: 'I', withAnomaly: false, startMs: 500,
            });
        });

        it('file là ArrayBuffer / Uint8Array cũng được nhận và đổi thành Buffer', async () => {
            const ab = new Uint8Array([49, 44, 50, 10]).buffer;
            await gateway.handleStream(authed(), up({ file: ab }));
            expect(Buffer.isBuffer(sourceOf().source.data)).toBe(true);
            expect(sourceOf().source.data.toString()).toBe('1,2\n');
            streams.prepare.mockClear();
            await gateway.handleStream(authed(), up({ file: new Uint8Array([49, 44, 50, 10]) }));
            expect(sourceOf().source.data.toString()).toBe('1,2\n');
        });

        it.each(['ECG_A', 'ecg_f', ' ECG_C '])('dataset %j -> kind=dataset đã chuẩn hoá', async (name) => {
            await gateway.handleStream(authed(), { dataset: name });
            expect(sourceOf().source).toEqual({ kind: 'dataset', name: name.trim().toUpperCase() });
        });

        it('recordingId (+ analysisId) -> kind=recording; analysisId bị bỏ qua với nguồn khác', async () => {
            await gateway.handleStreamAnomaly(authed(), { recordingId: 'rec-1', analysisId: 'an-1' });
            expect(sourceOf()).toMatchObject({ source: { kind: 'recording', recordingId: 'rec-1', analysisId: 'an-1' }, withAnomaly: true });
            streams.prepare.mockClear();
            await gateway.handleStreamAnomaly(authed(), { dataset: 'ECG_A', analysisId: 'an-1' });
            expect(sourceOf().source).toEqual({ kind: 'dataset', name: 'ECG_A' });
        });
    });

    describe('API [1] stream-ecg', () => {
        it('ack metadata rồi phát từng điểm "ecg-point" (không có isAnomaly), cuối cùng "ecg-stream-end"', async () => {
            streams.prepare.mockResolvedValue(prepared(false));
            const c = authed();
            const ack: any = await gateway.handleStream(c, { recordingId: 'rec-1', lead: 'II' });
            expect(ack).toMatchObject({ status: 'streaming', source: 'recording', sourceName: 'rec-1', recordingId: 'rec-1', lead: 'II', sampleRateHz: 100, totalPoints: 5, durationMs: 50, speed: 1, withAnomaly: false });
            expect(ack).not.toHaveProperty('anomalyPointCount');
            expect(c.emit).not.toHaveBeenCalled(); // chưa phát trước khi ack được trả

            jest.advanceTimersByTime(1);
            jest.advanceTimersByTime(200);
            const points = c.emit.mock.calls.filter((x: any[]) => x[0] === 'ecg-point').map((x: any[]) => x[1]);
            expect(points.map((p: any) => [p.seq, p.tMs, p.value])).toEqual([[0, 0, 1], [1, 10, 2], [2, 20, 3], [3, 30, 4], [4, 40, 5]]);
            expect(points[0]).toMatchObject({ streamId: ack.streamId, source: 'recording', sourceName: 'rec-1', recordingId: 'rec-1', lead: 'II' });
            expect(points[0]).not.toHaveProperty('isAnomaly');
            expect(c.emit).toHaveBeenLastCalledWith('ecg-stream-end', { streamId: ack.streamId, source: 'recording', sourceName: 'rec-1', recordingId: 'rec-1', totalPoints: 5 });
        });

        it('upload và dataset phát y hệt nhau; payload không có recordingId', async () => {
            const run = async (body: Record<string, unknown>, p: Record<string, unknown>) => {
                streams.prepare.mockResolvedValue(prepared(false, p));
                const c = authed();
                const ack: any = await gateway.handleStream(c, body);
                jest.advanceTimersByTime(1);
                jest.advanceTimersByTime(200);
                const pts = c.emit.mock.calls.filter((x: any[]) => x[0] === 'ecg-point').map((x: any[]) => x[1]);
                const end = c.emit.mock.calls.find((x: any[]) => x[0] === 'ecg-stream-end')![1];
                gateway.handleDisconnect(c);
                return { ack, pts, end };
            };
            const norm = (r: any, id: string) => ({ ack: { ...r.ack, streamId: id, sourceName: '-', source: '-' }, pts: r.pts.map((p: any) => ({ ...p, streamId: id, sourceName: '-', source: '-' })), end: { ...r.end, streamId: id, sourceName: '-', source: '-' } });
            const a = await run(up(), { source: 'upload', sourceName: 'ecg.csv', recordingId: undefined });
            const b = await run({ dataset: 'ECG_A' }, { source: 'dataset', sourceName: 'ECG_A', recordingId: undefined });
            expect(a.ack).toMatchObject({ source: 'upload', sourceName: 'ecg.csv', status: 'streaming' });
            expect(b.ack).toMatchObject({ source: 'dataset', sourceName: 'ECG_A', status: 'streaming' });
            expect(a.pts).toHaveLength(5);
            expect(a.pts[0]).not.toHaveProperty('recordingId');
            expect(a.ack).not.toHaveProperty('recordingId');
            expect(norm(a, 'x')).toEqual(norm(b, 'x'));
        });
    });

    describe('API [2] stream-ecg-anomaly', () => {
        it('phát "ecg-point-anomaly" kèm isAnomaly 0/1; ack có overallResult + anomalyPointCount (+ analysisId với recording)', async () => {
            streams.prepare.mockResolvedValue(prepared(true));
            const c = authed();
            const ack = await gateway.handleStreamAnomaly(c, { recordingId: 'rec-1', analysisId: 'an-1' });
            expect(streams.prepare).toHaveBeenCalledWith(expect.objectContaining({ withAnomaly: true, source: { kind: 'recording', recordingId: 'rec-1', analysisId: 'an-1' } }));
            expect(ack).toMatchObject({ status: 'streaming', withAnomaly: true, analysisId: 'an-1', overallResult: 'abnormal', anomalyPointCount: 2 });

            jest.advanceTimersByTime(1);
            jest.advanceTimersByTime(200);
            const points = c.emit.mock.calls.filter((x: any[]) => x[0] === 'ecg-point-anomaly').map((x: any[]) => x[1]);
            expect(points.map((p: any) => p.isAnomaly)).toEqual([0, 1, 1, 0, 0]);
            expect(c.emit.mock.calls.some((x: any[]) => x[0] === 'ecg-point')).toBe(false);
        });

        it('upload/dataset: ack không có analysisId nhưng có overallResult của AI', async () => {
            streams.prepare.mockResolvedValue(prepared(true, { source: 'dataset', sourceName: 'ECG_A', recordingId: undefined, analysisId: undefined }));
            const ack: any = await gateway.handleStreamAnomaly(authed(), { dataset: 'ECG_A' });
            expect(ack).toMatchObject({ status: 'streaming', source: 'dataset', sourceName: 'ECG_A', overallResult: 'abnormal', anomalyPointCount: 2 });
            expect(ack).not.toHaveProperty('analysisId');
            expect(ack).not.toHaveProperty('recordingId');
        });

        it('chuyển lỗi nghiệp vụ (kể cả mã AI_*) thành ack { status:error, code }', async () => {
            streams.prepare.mockRejectedValue(new EcgStreamError('ANALYSIS_NOT_READY', 'chưa có AI'));
            await expect(gateway.handleStreamAnomaly(authed(), { recordingId: 'rec-1' })).resolves.toEqual({ status: 'error', code: 'ANALYSIS_NOT_READY', message: 'chưa có AI' });
            streams.prepare.mockRejectedValue(new EcgStreamError('AI_TIMEOUT', 'AI chậm'));
            await expect(gateway.handleStreamAnomaly(authed(), { dataset: 'ECG_A' })).resolves.toEqual({ status: 'error', code: 'AI_TIMEOUT', message: 'AI chậm' });
        });

        it('lỗi bất ngờ -> INTERNAL_ERROR, không lộ chi tiết', async () => {
            streams.prepare.mockRejectedValue(new Error('db password=secret'));
            const r: any = await gateway.handleStreamAnomaly(authed(), { recordingId: 'rec-1' });
            expect(r).toMatchObject({ status: 'error', code: 'INTERNAL_ERROR' });
            expect(JSON.stringify(r)).not.toContain('secret');
        });
    });

    describe('list-ecg-datasets', () => {
        it('trả danh sách dataset từ service', async () => {
            const datasets = [{ name: 'ECG_A', available: true, sampleRateHz: 100 }, { name: 'ECG_B', available: false, sampleRateHz: null }];
            streams.listDatasets.mockResolvedValue(datasets);
            await expect(gateway.handleListDatasets(authed())).resolves.toEqual({ status: 'ok', datasets });
        });
    });

    describe('vòng đời stream', () => {
        it('stream-ecg-stop dừng phát; gọi lại khi không có stream -> idle', async () => {
            streams.prepare.mockResolvedValue(prepared(false));
            const c = authed();
            await gateway.handleStream(c, { recordingId: 'rec-1' });
            jest.advanceTimersByTime(1);
            const before = c.emit.mock.calls.length;
            expect(gateway.handleStop(c)).toEqual({ status: 'stopped' });
            jest.advanceTimersByTime(500);
            expect(c.emit.mock.calls.length).toBe(before);
            expect(c.emit.mock.calls.some((x: any[]) => x[0] === 'ecg-stream-end')).toBe(false);
            expect(gateway.handleStop(c)).toEqual({ status: 'idle' });
        });

        it('bắt đầu stream mới thì dừng stream cũ của cùng socket', async () => {
            streams.prepare.mockResolvedValue(prepared(false, { samples: new Float32Array(100_000) }));
            const c = authed();
            const a1: any = await gateway.handleStream(c, { recordingId: 'rec-1' });
            jest.advanceTimersByTime(1);
            const a2: any = await gateway.handleStream(c, { dataset: 'ECG_A' });
            expect(a2.streamId).not.toBe(a1.streamId);
            c.emit.mockClear();
            jest.advanceTimersByTime(1);
            jest.advanceTimersByTime(100);
            const ids = new Set(c.emit.mock.calls.filter((x: any[]) => x[0] === 'ecg-point').map((x: any[]) => x[1].streamId));
            expect(ids).toEqual(new Set([a2.streamId]));
            gateway.handleDisconnect(c);
        });

        it('ngắt kết nối dừng stream và giải phóng timer', async () => {
            streams.prepare.mockResolvedValue(prepared(false, { samples: new Float32Array(100_000) }));
            const c = authed();
            await gateway.handleStream(c, { recordingId: 'rec-1' });
            jest.advanceTimersByTime(1);
            expect(jest.getTimerCount()).toBeGreaterThan(0);
            gateway.handleDisconnect(c);
            expect(jest.getTimerCount()).toBe(0);
        });

        it('client ngắt trong lúc nạp dữ liệu -> không tạo stream', async () => {
            const c = authed();
            streams.prepare.mockImplementation(async () => {
                c.disconnected = true;
                return prepared(false);
            });
            await expect(gateway.handleStream(c, { recordingId: 'rec-1' })).resolves.toMatchObject({ status: 'error', code: 'CANCELLED' });
            jest.advanceTimersByTime(100);
            expect(c.emit).not.toHaveBeenCalled();
        });

        describe('đang chờ AI (prepare chạy lâu)', () => {
            const deferred = <T,>() => {
                let resolve!: (v: T) => void;
                const promise = new Promise<T>((r) => (resolve = r));
                return { promise, resolve };
            };

            it('stop trong lúc chờ -> start đang chờ trả CANCELLED và không phát điểm nào', async () => {
                const d = deferred<any>();
                streams.prepare.mockReturnValue(d.promise);
                const c = authed();
                const pending = gateway.handleStreamAnomaly(c, { dataset: 'ECG_A' });
                await Promise.resolve();
                await Promise.resolve();
                expect(gateway.handleStop(c)).toEqual({ status: 'stopped' });
                d.resolve(prepared(true));
                await expect(pending).resolves.toMatchObject({ status: 'error', code: 'CANCELLED' });
                jest.advanceTimersByTime(200);
                expect(c.emit).not.toHaveBeenCalled();
                expect(jest.getTimerCount()).toBe(0);
            });

            it('start thứ hai trong lúc start đầu còn chờ AI -> chỉ start thứ hai phát (không rò stream)', async () => {
                const first = deferred<any>();
                streams.prepare.mockReturnValueOnce(first.promise).mockResolvedValueOnce(prepared(false, { samples: new Float32Array(100_000) }));
                const c = authed();
                const p1 = gateway.handleStreamAnomaly(c, { dataset: 'ECG_A' });
                await Promise.resolve();
                await Promise.resolve();
                const a2: any = await gateway.handleStream(c, { dataset: 'ECG_B' });
                expect(a2.status).toBe('streaming');
                first.resolve(prepared(true));
                await expect(p1).resolves.toMatchObject({ status: 'error', code: 'CANCELLED' });
                jest.advanceTimersByTime(1);
                jest.advanceTimersByTime(100);
                const ids = new Set(c.emit.mock.calls.filter((x: any[]) => String(x[0]).startsWith('ecg-point')).map((x: any[]) => x[1].streamId));
                expect(ids).toEqual(new Set([a2.streamId]));
                gateway.handleDisconnect(c);
                expect(jest.getTimerCount()).toBe(0);
            });

            it('ngắt kết nối khi đang chờ -> CANCELLED, không tạo timer', async () => {
                const d = deferred<any>();
                streams.prepare.mockReturnValue(d.promise);
                const c = authed();
                const pending = gateway.handleStreamAnomaly(c, { dataset: 'ECG_A' });
                await Promise.resolve();
                await Promise.resolve();
                gateway.handleDisconnect(c);
                d.resolve(prepared(true));
                await expect(pending).resolves.toMatchObject({ status: 'error', code: 'CANCELLED' });
                expect(jest.getTimerCount()).toBe(0);
            });
        });
    });
});
