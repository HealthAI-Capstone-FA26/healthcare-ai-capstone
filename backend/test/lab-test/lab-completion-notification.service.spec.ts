import { Logger } from '@nestjs/common';
import { LabCompletionNotificationService } from '../../src/modules/lab-test/lab-completion/lab-completion-notification.service';

/**
 * WF-03 · F-15 "Notification, statistics, audit" — acceptance: "Test completion alerts the patient".
 * Function 21 (Report5) · phần WF-03: TC-F21-01..03 = UTCID01..03 (notifyEncounterCompleted).
 * UTCID04..07 là bổ sung (encounter/kết quả không tồn tại, bệnh nhân không có email, notifyForResult).
 *
 * Kênh: bác sĩ = in_app; bệnh nhân = in_app + email + zalo_oa (sms không dùng ở luồng này).
 */
describe('LabCompletionNotificationService - Function 21 (F-15, WF-03): diagnostics completion notification', () => {
    const ENCOUNTER_ID = 'enc-001';

    const buildEncounter = (o: Record<string, unknown> = {}) => ({
        status: 'awaiting_review',
        encounterCode: 'ENC-20261118-0001',
        patient: { patientId: 'pat-001', email: 'patient@example.com' },
        doctor: { userId: 'doc-001', user: { email: 'doctor@example.com' } },
        ...o,
    });

    const makeHarness = (encounter: any = buildEncounter()) => {
        const prisma = {
            encounter: { findUnique: jest.fn().mockResolvedValue(encounter) },
            diagnosticTask: { count: jest.fn().mockResolvedValue(2) },
            diagnosticResult: { findUnique: jest.fn() },
        };
        const dispatcher = { dispatch: jest.fn().mockResolvedValue(undefined) };
        const service = new LabCompletionNotificationService(prisma as any, dispatcher as any);
        return { service, prisma, dispatcher };
    };

    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let debugSpy: jest.SpyInstance;
    beforeEach(() => {
        logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        debugSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });

    // UTCID01 (TC-F21-01): Normal - awaiting_review, có bác sĩ + bệnh nhân -> gửi diagnostics_completed cho cả hai đúng kênh
    it('UTCID01 [N]: should dispatch diagnostics_completed to the doctor (in_app) and the patient (in_app, email, zalo_oa)', async () => {
        const h = makeHarness();

        await h.service.notifyEncounterCompleted(ENCOUNTER_ID);

        expect(h.prisma.diagnosticTask.count).toHaveBeenCalledWith({
            where: { orderItem: { status: 'ordered', order: { encounterId: ENCOUNTER_ID } }, status: { not: 'cancelled' } },
        });
        expect(h.dispatcher.dispatch).toHaveBeenCalledTimes(2);
        expect(h.dispatcher.dispatch).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                notificationType: 'diagnostics_completed',
                referenceType: 'encounter',
                referenceId: ENCOUNTER_ID,
                recipient: { userId: 'doc-001', email: 'doctor@example.com' },
            }),
            ['in_app'],
        );
        expect(h.dispatcher.dispatch).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                notificationType: 'diagnostics_completed',
                recipient: { patientId: 'pat-001', email: 'patient@example.com' },
                content: expect.stringContaining('ENC-20261118-0001'),
            }),
            ['in_app', 'email', 'zalo_oa'],
        );
        expect(h.dispatcher.dispatch.mock.calls[1][0].content).toContain('2 chỉ định cận lâm sàng');
        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining(`Đã gửi thông báo hoàn tất cận lâm sàng cho encounter ${ENCOUNTER_ID}`));
    });

    // UTCID02 (TC-F21-02): Boundary - chưa có bác sĩ phụ trách -> chỉ gửi cho bệnh nhân, ghi cảnh báo
    it('UTCID02 [B]: should notify only the patient and log a warning when the encounter has no assigned doctor', async () => {
        const h = makeHarness(buildEncounter({ doctor: null }));

        await h.service.notifyEncounterCompleted(ENCOUNTER_ID);

        expect(h.dispatcher.dispatch).toHaveBeenCalledTimes(1);
        expect(h.dispatcher.dispatch).toHaveBeenCalledWith(
            expect.objectContaining({ recipient: { patientId: 'pat-001', email: 'patient@example.com' } }),
            ['in_app', 'email', 'zalo_oa'],
        );
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('chưa có bác sĩ phụ trách — không gửi thông báo cho bác sĩ'));
    });

    // UTCID03 (TC-F21-03): Abnormal - encounter chưa 'awaiting_review' -> thoát sớm, không gửi gì
    it("UTCID03 [A]: should return early and dispatch nothing when the encounter is not in 'awaiting_review'", async () => {
        const h = makeHarness(buildEncounter({ status: 'diagnostics_in_progress' }));

        await expect(h.service.notifyEncounterCompleted(ENCOUNTER_ID)).resolves.toBeUndefined();

        expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
        expect(h.prisma.diagnosticTask.count).not.toHaveBeenCalled();
        expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining("không phải 'awaiting_review' — bỏ qua thông báo"));
    });

    // UTCID04: Boundary - bệnh nhân không có email -> vẫn gửi (email undefined), kênh email tự bỏ qua ở dispatcher
    it('UTCID04 [B]: should still notify the patient with an undefined email when the patient has no email on file', async () => {
        const h = makeHarness(buildEncounter({ patient: { patientId: 'pat-001', email: null } }));

        await h.service.notifyEncounterCompleted(ENCOUNTER_ID);

        expect(h.dispatcher.dispatch).toHaveBeenLastCalledWith(
            expect.objectContaining({ recipient: { patientId: 'pat-001', email: undefined } }),
            ['in_app', 'email', 'zalo_oa'],
        );
    });

    // UTCID05: Abnormal - encounter không tồn tại -> không ném lỗi, không gửi
    it('UTCID05 [A]: should return silently when the encounter does not exist', async () => {
        const h = makeHarness(null);

        await expect(h.service.notifyEncounterCompleted('enc-missing')).resolves.toBeUndefined();

        expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
    });

    // UTCID06: Normal - notifyForResult: tra encounter từ kết quả rồi ủy quyền cho notifyEncounterCompleted
    it('UTCID06 [N]: should resolve the encounter of a result and delegate to notifyEncounterCompleted', async () => {
        const h = makeHarness();
        h.prisma.diagnosticResult.findUnique.mockResolvedValue({ task: { orderItem: { order: { encounterId: ENCOUNTER_ID } } } });

        await h.service.notifyForResult('res-001');

        expect(h.prisma.diagnosticResult.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { resultId: 'res-001' } }));
        expect(h.prisma.encounter.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { encounterId: ENCOUNTER_ID } }));
        expect(h.dispatcher.dispatch).toHaveBeenCalledTimes(2);
    });

    // UTCID07: Abnormal - notifyForResult với kết quả không tồn tại -> không tra encounter, không gửi
    it('UTCID07 [A]: should do nothing when the lab result does not exist', async () => {
        const h = makeHarness();
        h.prisma.diagnosticResult.findUnique.mockResolvedValue(null);

        await expect(h.service.notifyForResult('res-missing')).resolves.toBeUndefined();

        expect(h.prisma.encounter.findUnique).not.toHaveBeenCalled();
        expect(h.dispatcher.dispatch).not.toHaveBeenCalled();
    });
});
