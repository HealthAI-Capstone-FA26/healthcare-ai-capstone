import { Logger } from '@nestjs/common';

// Không chạm S3 thật: mock cấu hình upload + presign
jest.mock('../../src/common/configs/upload.config', () => ({
    BUCKET_NAME: 'test-bucket',
    minioClient: { putObject: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock('../../src/modules/lab-test/lab-result-entry/diagnostic-upload.config', () => ({
    isExternalUrl: (u: string) => /^https?:\/\//.test(u),
    presignDiagnosticFile: jest.fn().mockResolvedValue('https://s3.example/signed-image.jpg'),
}));

import { LabResultZaloDeliveryService } from '../../src/modules/lab-test/lab-completion/lab-result-zalo-delivery.service';

/** Gửi tài liệu kết quả lab qua Zalo: máu (PDF link) + ECG (PDF link) + X-quang (ảnh). */
describe('LabResultZaloDeliveryService', () => {
    const ENC = 'enc-001';

    const ecgJson = Buffer.from(JSON.stringify({ leads: { I: Array.from({ length: 1000 }, (_, i) => Math.sin(i / 10)), II: Array.from({ length: 1000 }, (_, i) => Math.cos(i / 10)) } }));

    const tasks = [
        {
            orderItem: { service: { serviceName: 'Xét nghiệm máu', modality: 'blood_test' } },
            result: {
                resultedAt: new Date(), overallConclusion: null, attachments: [],
                values: [{ valueNumeric: { toString: () => '5.2000' }, valueBoolean: null, valueText: null, isAbnormal: true, parameter: { parameterName: 'LDL', unit: 'mmol/L', displayOrder: 1 } }],
            },
            ecgRecordings: [],
        },
        {
            orderItem: { service: { serviceName: 'Điện tâm đồ', modality: 'ecg' } },
            result: { resultedAt: new Date(), overallConclusion: null, values: [], attachments: [] },
            ecgRecordings: [{ sampleRateHz: 100, numLeads: 2, leadNames: ['I', 'II'], signalFormat: 'json', signalFileUrl: 'ecg/x.json', startedAt: null, createdAt: new Date(), analyses: [] }],
        },
        {
            orderItem: { service: { serviceName: 'X-quang ngực', modality: 'xray' } },
            result: { resultedAt: new Date(), overallConclusion: null, values: [], attachments: [{ fileType: 'image', attachmentRole: 'primary', fileUrl: 'diag/a.jpg', uploadedAt: new Date() }, { fileType: 'dicom', attachmentRole: 'primary', fileUrl: 'diag/a.dcm', uploadedAt: new Date() }] },
            ecgRecordings: [],
        },
    ];

    const make = (over: { tasks?: any[]; destination?: string } = {}) => {
        const prisma = {
            encounter: { findUnique: jest.fn().mockResolvedValue({ encounterCode: 'ENC-1', patient: { patientId: 'p1', fullName: 'Nguyễn Văn An', patientCode: 'BN1' } }) },
            diagnosticTask: { findMany: jest.fn().mockResolvedValue(over.tasks ?? tasks) },
        };
        const zalo = { isConfigured: () => true, isBotMode: () => true, sendText: jest.fn().mockResolvedValue(undefined), sendPhoto: jest.fn().mockResolvedValue(undefined), sendFile: jest.fn() };
        const resolver = { resolve: jest.fn().mockResolvedValue(over.destination ? { allowed: true, destination: over.destination } : { allowed: false, reason: 'NO_CONTACT' }) };
        const redis = { setJson: jest.fn().mockResolvedValue(undefined) };
        const storage = { get: jest.fn().mockResolvedValue(ecgJson) };
        const service = new LabResultZaloDeliveryService(prisma as any, zalo as any, resolver as any, redis as any, storage as any);
        return { service, prisma, zalo, resolver, redis, storage };
    };

    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('gửi 2 link PDF (máu, ECG) và 1 ảnh X-quang tới chat_id đã liên kết; bỏ qua DICOM', async () => {
        const h = make({ destination: 'chat-1' });
        const report = await h.service.sendResultsForEncounter(ENC);

        expect(report.errors).toEqual([]);
        expect(report.chatId).toBe('chat-1');
        expect(report.sent).toHaveLength(3);
        expect(h.zalo.sendText).toHaveBeenCalledTimes(2);
        expect(h.zalo.sendText.mock.calls[0][1]).toContain('/api/v1/zalo-bot/pdf/');
        expect(h.zalo.sendPhoto).toHaveBeenCalledTimes(1);
        expect(h.zalo.sendPhoto).toHaveBeenCalledWith('chat-1', 'https://s3.example/signed-image.jpg', expect.stringContaining('X-quang'));
        expect(h.redis.setJson).toHaveBeenCalledTimes(2);
    });

    it('zaloUserId (test) bỏ qua bước tra liên kết bệnh nhân', async () => {
        const h = make();
        const report = await h.service.sendResultsForEncounter(ENC, { zaloUserId: 'chat-test' });
        expect(h.resolver.resolve).not.toHaveBeenCalled();
        expect(report.chatId).toBe('chat-test');
        expect(report.sent).toHaveLength(3);
    });

    it('bệnh nhân chưa liên kết Zalo -> không gửi gì, báo lý do trong skipped', async () => {
        const h = make();
        const report = await h.service.sendResultsForEncounter(ENC);
        expect(h.zalo.sendText).not.toHaveBeenCalled();
        expect(report.sent).toEqual([]);
        expect(report.skipped[0]).toContain('NO_CONTACT');
    });

    it('1 tài liệu lỗi không chặn các tài liệu còn lại và không throw', async () => {
        const h = make({ destination: 'chat-1' });
        h.storage.get.mockRejectedValue(new Error('S3 down')); // ECG lỗi
        const report = await h.service.sendResultsForEncounter(ENC);
        expect(report.errors).toHaveLength(1);
        expect(report.errors[0]).toContain('S3 down');
        expect(report.sent).toHaveLength(2); // máu + X-quang vẫn gửi
    });
});
