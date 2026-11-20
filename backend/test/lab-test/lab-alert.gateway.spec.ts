import { LabAlertGateway } from '../../src/modules/lab-test/lab-anomaly/lab-alert.gateway';

const makeClient = (auth: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
    ({ id: 'c1', data: {} as Record<string, unknown>, handshake: { auth, headers }, emit: jest.fn(), disconnect: jest.fn(), join: jest.fn().mockResolvedValue(undefined), leave: jest.fn() }) as any;

describe('LabAlertGateway (/lab-alerts)', () => {
    const jwt = { verifyAsync: jest.fn() };
    const roles = { assertActorRole: jest.fn() };
    let gateway: LabAlertGateway;
    const prev = process.env.LAB_ALERT_REQUIRE_AUTH;

    beforeEach(() => {
        jest.resetAllMocks();
        delete process.env.LAB_ALERT_REQUIRE_AUTH;
        gateway = new LabAlertGateway(jwt as any, roles as any);
    });
    afterAll(() => {
        if (prev === undefined) delete process.env.LAB_ALERT_REQUIRE_AUTH;
        else process.env.LAB_ALERT_REQUIRE_AUTH = prev;
    });

    it('từ chối kết nối khi thiếu token', async () => {
        const c = makeClient();
        await gateway.handleConnection(c);
        expect(c.disconnect).toHaveBeenCalledWith(true);
    });

    it('từ chối khi token không hợp lệ', async () => {
        jwt.verifyAsync.mockRejectedValue(new Error('jwt expired'));
        const c = makeClient({ token: 'bad' });
        await gateway.handleConnection(c);
        expect(c.disconnect).toHaveBeenCalled();
    });

    it('chấp nhận token hợp lệ (auth.token hoặc header) và lưu userId', async () => {
        jwt.verifyAsync.mockResolvedValue({ sub: 'u1' });
        const a = makeClient({ token: 'Bearer abc' });
        await gateway.handleConnection(a);
        expect(jwt.verifyAsync).toHaveBeenCalledWith('abc');
        expect(a.data.userId).toBe('u1');
        const b = makeClient({}, { authorization: 'Bearer xyz' });
        await gateway.handleConnection(b);
        expect(jwt.verifyAsync).toHaveBeenLastCalledWith('xyz');
        expect(b.disconnect).not.toHaveBeenCalled();
    });

    it('subscribe: join room khi đúng vai trò', async () => {
        roles.assertActorRole.mockResolvedValue('DOCTOR');
        const c = makeClient();
        c.data.userId = 'u1';
        await expect(gateway.handleSubscribe(c, { encounterId: 'enc-1' })).resolves.toEqual({ status: 'subscribed', encounterId: 'enc-1' });
        expect(c.join).toHaveBeenCalledWith('encounter:enc-1');
    });

    it('subscribe: từ chối vai trò không được phép / chưa xác thực / encounterId rỗng', async () => {
        roles.assertActorRole.mockRejectedValue(new Error('forbidden'));
        const c = makeClient();
        c.data.userId = 'u1';
        await expect(gateway.handleSubscribe(c, { encounterId: 'enc-1' })).resolves.toEqual({ status: 'forbidden' });
        await expect(gateway.handleSubscribe(makeClient(), { encounterId: 'enc-1' })).resolves.toEqual({ status: 'forbidden' });
        await expect(gateway.handleSubscribe(c, {})).resolves.toMatchObject({ status: 'error' });
        expect(c.join).not.toHaveBeenCalled();
    });

    it('LAB_ALERT_REQUIRE_AUTH=false: bỏ qua xác thực (dev)', async () => {
        process.env.LAB_ALERT_REQUIRE_AUTH = 'false';
        const c = makeClient();
        await gateway.handleConnection(c);
        expect(c.disconnect).not.toHaveBeenCalled();
        await expect(gateway.handleSubscribe(c, { encounterId: 'enc-9' })).resolves.toMatchObject({ status: 'subscribed' });
    });

    it('pushEcgAlertUpdate emit vào đúng room', () => {
        const emit = jest.fn();
        (gateway as any).server = { to: jest.fn().mockReturnValue({ emit }) };
        const payload = { ecgRecordingId: 'r', recordingId: 'r', analysisId: 'a', encounterId: 'enc-1', status: 'queued', overallResult: null, anomalyCount: 0, maxSeverity: null, errorCode: null };
        gateway.pushEcgAlertUpdate(payload);
        expect((gateway as any).server.to).toHaveBeenCalledWith('encounter:enc-1');
        expect(emit).toHaveBeenCalledWith('ecg-alert-update', payload);
    });
});
