import { createHash } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { EcgRecordingService } from '../../src/modules/lab-test/ecg-recording/ecg-recording.service';
import { ECG_RECORDING_COMPLETED_EVENT } from '../../src/modules/lab-test/ecg-recording/events/ecg-recording-completed.event';
import { ACTOR_ROLE } from '../../src/common/constants/actor-role.constant';

// @nestjs/event-emitter phát hành ESM — Jest (CJS) không nạp được; chỉ cần kiểu/decorator nên mock rỗng.
jest.mock('@nestjs/event-emitter', () => ({ EventEmitter2: class {}, OnEvent: () => () => undefined }));

/**
 * WF-03 · F-11 — bước "ECG Signal Upload (Lab Staff)" của DS-05/DS-06: tín hiệu lưu MinIO, bản ghi 'completed',
 * phát event để AI chạy nền (upload không chờ AI).
 * Function 18 (bổ sung): EcgRecordingService.createFromFile(taskId, dto, file, userId) -> UTCID20..28
 */
describe('EcgRecordingService - Function 18 (supplement): createFromFile (F-11)', () => {
    const TASK_ID = 'task-ecg';
    const STAFF_ID = 'staff-001';
    const CSV = Buffer.from('t,I,II\n0,0.10,0.20\n1,0.11,0.19\n');
    const CHECKSUM = createHash('sha256').update(CSV).digest('hex');

    const baseDto = () => ({ recordingType: 'resting_12_lead', signalFormat: 'csv', sampleRateHz: 500, numLeads: 2, leadNames: ['I', 'II'], durationMs: 10000 });
    const csvFile = (originalname = 'ECG_A.csv') => ({ originalname, buffer: CSV, mimetype: 'text/csv', size: CSV.length }) as any;
    const buildTask = (o: Record<string, unknown> = {}) => ({
        taskId: TASK_ID,
        paymentVerified: true,
        status: 'in_progress',
        assignedStaffUserId: STAFF_ID,
        orderItem: { service: { modality: 'ecg' }, order: { encounterId: 'enc-001' } },
        ...o,
    });

    const makeHarness = (task: any = buildTask()) => {
        const prisma = {
            diagnosticTask: { findUnique: jest.fn().mockResolvedValue(task) },
            ecgRecording: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ ecgRecordingId: 'rec-001' }),
                update: jest.fn().mockResolvedValue({}),
                delete: jest.fn().mockResolvedValue({}),
            },
        };
        const actorRoleService = { assertActorRole: jest.fn().mockResolvedValue(undefined) };
        const eventEmitter = { emit: jest.fn() };
        const storage = { put: jest.fn().mockResolvedValue(undefined) };
        const service = new EcgRecordingService(prisma as any, actorRoleService as any, eventEmitter as any, storage as any);
        jest.spyOn(service, 'getById').mockResolvedValue({ ecgRecordingId: 'rec-001', status: 'completed' } as any);
        return { service, prisma, actorRoleService, eventEmitter, storage };
    };

    const prevLeads = process.env.ECG_REQUIRED_LEADS;
    beforeEach(() => {
        process.env.ECG_REQUIRED_LEADS = '2';
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.restoreAllMocks();
        if (prevLeads === undefined) delete process.env.ECG_REQUIRED_LEADS;
        else process.env.ECG_REQUIRED_LEADS = prevLeads;
    });

    // UTCID20: Normal - upload CSV hợp lệ: pending -> lưu MinIO -> completed -> phát event autoAnalyze mặc định true
    it('UTCID20 [N]: should store the signal in object storage, mark the recording completed and emit the completed event (autoAnalyze defaults to true)', async () => {
        const h = makeHarness();

        await h.service.createFromFile(TASK_ID, baseDto() as any, csvFile(), STAFF_ID);

        expect(h.actorRoleService.assertActorRole).toHaveBeenCalledWith(STAFF_ID, [ACTOR_ROLE.LAB_STAFF]);
        expect(h.prisma.ecgRecording.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                taskId: TASK_ID,
                encounterId: 'enc-001',
                status: 'pending',
                signalFormat: 'csv',
                numLeads: 2,
                signalChecksum: CHECKSUM,
                acquisitionMeta: expect.objectContaining({ originalFileName: 'ECG_A.csv' }),
            }),
            select: { ecgRecordingId: true },
        });
        expect(h.storage.put).toHaveBeenCalledWith('ecg/enc-001/rec-001.csv', CSV, 'text/csv');
        expect(h.prisma.ecgRecording.update).toHaveBeenCalledWith({
            where: { ecgRecordingId: 'rec-001' },
            data: { signalFileUrl: 'ecg/enc-001/rec-001.csv', status: 'completed' },
        });
        expect(h.eventEmitter.emit).toHaveBeenCalledWith(
            ECG_RECORDING_COMPLETED_EVENT,
            expect.objectContaining({ ecgRecordingId: 'rec-001', autoAnalyze: true }),
        );
    });

    // UTCID21: Boundary - autoAnalyze = false -> event mang autoAnalyze false (không chạy AI nền)
    it('UTCID21 [B]: should emit the completed event with autoAnalyze = false when the lab staff opts out of AI analysis', async () => {
        const h = makeHarness();

        await h.service.createFromFile(TASK_ID, { ...baseDto(), autoAnalyze: false } as any, csvFile(), STAFF_ID);

        expect(h.eventEmitter.emit).toHaveBeenCalledWith(
            ECG_RECORDING_COMPLETED_EVENT,
            expect.objectContaining({ ecgRecordingId: 'rec-001', autoAnalyze: false }),
        );
    });

    // UTCID22: Abnormal - task chưa thanh toán -> 403, không tạo bản ghi
    it('UTCID22 [A]: should throw ForbiddenException and create nothing when the task is unpaid', async () => {
        const h = makeHarness(buildTask({ paymentVerified: false }));

        await expect(h.service.createFromFile(TASK_ID, baseDto() as any, csvFile(), STAFF_ID)).rejects.toThrow(ForbiddenException);

        expect(h.prisma.ecgRecording.create).not.toHaveBeenCalled();
        expect(h.storage.put).not.toHaveBeenCalled();
    });

    // UTCID23: Abnormal - task chưa được tiếp nhận (ready) -> 400
    it("UTCID23 [A]: should throw BadRequestException when the task has not been received yet (status is not 'in_progress')", async () => {
        const h = makeHarness(buildTask({ status: 'ready' }));

        await expect(h.service.createFromFile(TASK_ID, baseDto() as any, csvFile(), STAFF_ID)).rejects.toThrow(/Cần tiếp nhận/);

        expect(h.prisma.ecgRecording.create).not.toHaveBeenCalled();
    });

    // UTCID24: Abnormal - task không phải ECG (vd. xét nghiệm máu)
    it('UTCID24 [A]: should throw BadRequestException when the task modality is not ecg', async () => {
        const h = makeHarness(buildTask({ orderItem: { service: { modality: 'blood_test' }, order: { encounterId: 'enc-001' } } }));

        await expect(h.service.createFromFile(TASK_ID, baseDto() as any, csvFile(), STAFF_ID)).rejects.toThrow(/chỉ nhiệm vụ ECG/);

        expect(h.prisma.ecgRecording.create).not.toHaveBeenCalled();
    });

    // UTCID25: Abnormal - task do KTV khác phụ trách
    it('UTCID25 [A]: should throw ForbiddenException when the task belongs to another lab staff', async () => {
        const h = makeHarness(buildTask({ assignedStaffUserId: 'staff-other' }));

        await expect(h.service.createFromFile(TASK_ID, baseDto() as any, csvFile(), STAFF_ID)).rejects.toThrow(ForbiddenException);

        expect(h.prisma.ecgRecording.create).not.toHaveBeenCalled();
    });

    // UTCID26: Abnormal - cùng tệp (checksum) đã tải cho task -> 409, không ghi đè
    it('UTCID26 [A]: should throw ConflictException when the same file (checksum) was already uploaded for the task', async () => {
        const h = makeHarness();
        h.prisma.ecgRecording.findFirst.mockResolvedValue({ ecgRecordingId: 'rec-old' });

        await expect(h.service.createFromFile(TASK_ID, baseDto() as any, csvFile(), STAFF_ID)).rejects.toThrow(ConflictException);

        expect(h.prisma.ecgRecording.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({ where: { taskId: TASK_ID, signalChecksum: CHECKSUM, status: { not: 'cancelled' } } }),
        );
        expect(h.storage.put).not.toHaveBeenCalled();
    });

    // UTCID27: Abnormal - lưu MinIO lỗi -> xoá bản ghi nháp (không để 'ghost'), 400, không phát event
    it('UTCID27 [A]: should delete the draft recording, throw BadRequestException and emit nothing when object storage fails', async () => {
        const h = makeHarness();
        h.storage.put.mockRejectedValue(new Error('MinIO down'));

        await expect(h.service.createFromFile(TASK_ID, baseDto() as any, csvFile(), STAFF_ID)).rejects.toThrow(/Không lưu được tệp/);

        expect(h.prisma.ecgRecording.delete).toHaveBeenCalledWith({ where: { ecgRecordingId: 'rec-001' } });
        expect(h.prisma.ecgRecording.update).not.toHaveBeenCalled();
        expect(h.eventEmitter.emit).not.toHaveBeenCalled();
    });

    // UTCID28: Abnormal - phần mở rộng không khớp signalFormat (.txt cho csv) -> 400 trước khi chạm DB
    it('UTCID28 [A]: should throw BadRequestException before any DB access when the file extension does not match signalFormat', async () => {
        const h = makeHarness();

        await expect(h.service.createFromFile(TASK_ID, baseDto() as any, csvFile('ECG_A.txt'), STAFF_ID)).rejects.toThrow(BadRequestException);

        expect(h.prisma.diagnosticTask.findUnique).not.toHaveBeenCalled();
        expect(h.storage.put).not.toHaveBeenCalled();
    });
});
