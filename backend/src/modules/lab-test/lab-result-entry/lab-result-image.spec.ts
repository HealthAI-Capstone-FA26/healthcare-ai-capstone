import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { assertFileSignature, isExternalUrl } from './diagnostic-upload.config';
import { LabResultService } from './lab-result.service';
import { LAB_RESULT_SUBMITTED_EVENT } from '../lab-anomaly/events/lab-result-submitted.event';
import { buildPublicReadPolicy, PUBLIC_READ_PREFIXES } from '../../../common/configs/upload.config';

// @nestjs/event-emitter phát hành ESM — Jest (CJS) không nạp được; chỉ cần kiểu cho constructor nên mock rỗng.
jest.mock('@nestjs/event-emitter', () => ({ EventEmitter2: class {}, OnEvent: () => () => undefined }));
jest.mock('../lab-task-intake/lab-task.service', () => ({ LabTaskService: class {} }));
jest.mock('../lab-task-intake/diagnostic-progress.service', () => ({ DiagnosticProgressService: class {} }));
jest.mock('./diagnostic-upload.config', () => {
    const actual = jest.requireActual('./diagnostic-upload.config');
    return { ...actual, presignDiagnosticFile: jest.fn(async (key: string) => `https://minio.local/signed/${key}?X-Amz-Expires=900`) };
});

const file = (mimetype: string, bytes: Buffer, originalname = 'f.bin') => ({ buffer: bytes, mimetype, originalname }) as any;
const pad = (head: number[], offset = 0, len = 256) => {
    const b = Buffer.alloc(len);
    Buffer.from(head).copy(b, offset);
    return b;
};

describe('assertFileSignature — kiểm tra nội dung thật của tệp', () => {
    const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
    const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const DICOM = pad([0x44, 0x49, 0x43, 0x4d], 128, 300);

    it('chấp nhận JPEG/PNG/DICOM/PDF/MP4 hợp lệ', () => {
        expect(() => assertFileSignature(file('image/jpeg', JPEG), 'image')).not.toThrow();
        expect(() => assertFileSignature(file('image/png', PNG), 'image')).not.toThrow();
        expect(() => assertFileSignature(file('application/dicom', DICOM), 'dicom')).not.toThrow();
        expect(() => assertFileSignature(file('application/octet-stream', DICOM), 'dicom')).not.toThrow();
        expect(() => assertFileSignature(file('application/pdf', Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(64)])), 'pdf')).not.toThrow();
        expect(() => assertFileSignature(file('video/mp4', pad([0x66, 0x74, 0x79, 0x70], 4)), 'video')).not.toThrow();
    });

    it('từ chối MIME giả: file .exe khai báo image/jpeg', () => {
        const exe = pad([0x4d, 0x5a, 0x90, 0x00]);
        expect(() => assertFileSignature(file('image/jpeg', exe, 'x.jpg'), 'image')).toThrow(BadRequestException);
    });

    it('từ chối JPEG khai báo là PNG, DICOM thiếu DICM, octet-stream cho fileType image', () => {
        expect(() => assertFileSignature(file('image/png', JPEG), 'image')).toThrow(/không phải PNG/);
        expect(() => assertFileSignature(file('application/dicom', pad([1, 2, 3], 0, 300)), 'dicom')).toThrow(/DICM/);
        expect(() => assertFileSignature(file('application/octet-stream', JPEG), 'image')).toThrow(BadRequestException);
        expect(() => assertFileSignature(file('image/jpeg', JPEG), 'dicom')).toThrow(/không khớp MIME/);
    });

    it('từ chối script shebang, ELF và tệp rỗng', () => {
        expect(() => assertFileSignature(file('application/octet-stream', Buffer.from('#!/bin/sh\nrm -rf /\n__________'), 'a.sh'), 'raw_export')).toThrow(/thực thi/);
        expect(() => assertFileSignature(file('application/octet-stream', pad([0x7f, 0x45, 0x4c, 0x46]), 'a'), 'raw_export')).toThrow(/thực thi/);
        expect(() => assertFileSignature(file('image/jpeg', Buffer.alloc(0)), 'image')).toThrow(/rỗng/);
    });

    it('isExternalUrl', () => {
        expect(isExternalUrl('https://pacs.example.com/a.dcm')).toBe(true);
        expect(isExternalUrl('diagnostic-attachments/abc/1.jpg')).toBe(false);
    });
});

describe('bucket policy — ảnh y khoa không còn công khai', () => {
    it('chỉ cho đọc công khai các prefix được liệt kê, không dùng wildcard toàn bucket', () => {
        const policy = buildPublicReadPolicy('app-uploads');
        const resources = policy.Statement[0].Resource;
        expect(resources).toEqual(PUBLIC_READ_PREFIXES.map((p) => `arn:aws:s3:::app-uploads/${p}/*`));
        expect(resources).not.toContain('arn:aws:s3:::app-uploads/*');
        expect(resources.some((r) => r.includes('diagnostic-attachments'))).toBe(false);
        expect(resources.some((r) => r.includes('ecg'))).toBe(false);
    });
});

/** Dựng LabResultService với mock — tập trung vào luồng hoàn tất image_report. */
function makeService(opts: { resultKind?: string; taskStatus?: string; attachments?: { fileType: string }[]; role?: 'LAB_STAFF' | 'DOCTOR' | 'PATIENT' } = {}) {
    const state = {
        taskCompleted: false,
        findings: 'Mô tả TTE',
        events: [] as any[],
        taskStatus: opts.taskStatus ?? 'in_progress',
    };
    const tx = {
        diagnosticResult: {
            create: jest.fn(async () => ({ resultId: 'r1' })),
            update: jest.fn(async ({ data }: any) => { if (data.findings) state.findings = data.findings; }),
        },
    };
    const prisma: any = {
        diagnosticTask: {
            findUniqueOrThrow: jest.fn(async () => ({
                taskId: 't1', startedAt: new Date(), result: null,
                orderItem: { service: { serviceId: 's1', resultKind: opts.resultKind ?? 'image_report', serviceName: 'Siêu âm tim' } },
            })),
        },
        diagnosticResult: {
            findUnique: jest.fn(async () => ({
                resultId: 'r1', taskId: 't1', findings: state.findings, resultStatus: 'preliminary',
                attachments: opts.attachments ?? [],
                task: { status: state.taskStatus, orderItem: { service: { resultKind: opts.resultKind ?? 'image_report', serviceName: 'Siêu âm tim' } } },
            })),
        },
        diagnosticResultAttachment: {
            findMany: jest.fn(async () => [
                { attachmentId: 'a1', resultId: 'r1', fileUrl: 'diagnostic-attachments/r1/1.jpg' },
                { attachmentId: 'a2', resultId: 'r1', fileUrl: 'https://pacs.example.com/x.dcm' },
            ]),
            findUnique: jest.fn(async ({ where }: any) => (where.attachmentId === 'a1' ? { attachmentId: 'a1', resultId: 'r1', fileUrl: 'diagnostic-attachments/r1/1.jpg' } : null)),
        },
        $transaction: jest.fn(async (fn: any) => fn(tx)),
    };
    const labTaskService: any = {
        assertReadyForResultEntry: jest.fn(async () => ({})),
        markCompleted: jest.fn(async () => { state.taskCompleted = true; state.taskStatus = 'completed'; }),
    };
    const progress: any = { recomputeForTask: jest.fn(async () => ({ encounterBecameAwaitingReview: true })) };
    const emitter: any = { emit: jest.fn((name: string, payload: any) => state.events.push({ name, payload })) };
    const roles: any = {
        assertActorRole: jest.fn(async (_u: string, allowed: string[]) => {
            if (!allowed.includes(opts.role ?? 'LAB_STAFF')) throw new ForbiddenException('role');
        }),
    };
    const svc = new LabResultService(prisma, labTaskService, progress, emitter, roles);
    jest.spyOn(svc, 'getById').mockResolvedValue({ resultId: 'r1' } as any);
    return { svc, state, labTaskService, progress, tx };
}

describe('LabResultService — báo cáo hình ảnh (siêu âm tim, X-quang ngực)', () => {
    it('submit image_report: lưu kết quả nhưng KHÔNG hoàn tất task, không phát event', async () => {
        const { svc, state, labTaskService, progress } = makeService();
        await svc.submitResult('t1', { findings: 'EF 60%' } as any, 'u1');
        expect(labTaskService.markCompleted).not.toHaveBeenCalled();
        expect(progress.recomputeForTask).not.toHaveBeenCalled();
        expect(state.events).toHaveLength(0);
    });

    it('submit dịch vụ parametric vẫn hoàn tất ngay như cũ', async () => {
        const { svc, state, labTaskService } = makeService({ resultKind: 'parametric' });
        jest.spyOn(svc as any, 'resolveAndValidateValues').mockResolvedValue([]);
        await svc.submitResult('t1', { values: [{ parameterId: 'p', valueNumeric: 1 }] } as any, 'u1');
        expect(labTaskService.markCompleted).toHaveBeenCalledTimes(1);
        expect(state.events).toHaveLength(1);
        expect(state.events[0].name).toBe(LAB_RESULT_SUBMITTED_EVENT);
    });

    it('complete: chưa có hình và không có lý do -> từ chối', async () => {
        const { svc, labTaskService } = makeService({ attachments: [{ fileType: 'pdf' }] }); // PDF không tính là hình
        await expect(svc.completeResult('r1', {}, 'u1')).rejects.toThrow(/Chưa có hình ảnh/);
        expect(labTaskService.markCompleted).not.toHaveBeenCalled();
    });

    it('complete: đã có ảnh -> hoàn tất, tính lại encounter, phát event "có kết quả"', async () => {
        const { svc, state, labTaskService, progress } = makeService({ attachments: [{ fileType: 'image' }] });
        await svc.completeResult('r1', {}, 'u1');
        expect(labTaskService.markCompleted).toHaveBeenCalledWith('t1', expect.anything());
        expect(progress.recomputeForTask).toHaveBeenCalled();
        expect(state.events).toHaveLength(1);
        expect(state.events[0].payload).toMatchObject({ labResultId: 'r1', notifyCompletion: true }); // notifyCompletion = báo bác sĩ có kết quả
    });

    it('complete: không có hình nhưng nêu lý do -> hoàn tất và ghi lý do vào findings', async () => {
        const { svc, state } = makeService();
        await svc.completeResult('r1', { noImageReason: 'Máy siêu âm hỏng, bệnh nhân từ chối' }, 'u1');
        expect(state.taskCompleted).toBe(true);
        expect(state.findings).toContain('Mô tả TTE');
        expect(state.findings).toContain('[Không có hình ảnh đính kèm: Máy siêu âm hỏng, bệnh nhân từ chối]');
    });

    it('complete: gọi lần 2 -> 409; dịch vụ không phải image_report -> 400; sai vai trò -> 403', async () => {
        const done = makeService({ attachments: [{ fileType: 'dicom' }], taskStatus: 'completed' });
        await expect(done.svc.completeResult('r1', {}, 'u1')).rejects.toThrow(ConflictException);
        const wrongKind = makeService({ resultKind: 'parametric', attachments: [{ fileType: 'image' }] });
        await expect(wrongKind.svc.completeResult('r1', {}, 'u1')).rejects.toThrow(/báo cáo hình ảnh/);
        const patient = makeService({ role: 'PATIENT' });
        await expect(patient.svc.completeResult('r1', {}, 'u1')).rejects.toThrow(ForbiddenException);
    });

    it('listAttachments: trả presigned URL cho object key, giữ nguyên URL ngoài; PATIENT bị chặn', async () => {
        const { svc } = makeService({ role: 'DOCTOR' });
        const rows = await svc.listAttachments('r1', 'doc1');
        expect(rows[0].accessUrl).toContain('https://minio.local/signed/diagnostic-attachments/r1/1.jpg');
        expect(rows[0].accessUrlExpiresInSeconds).toBe(900);
        expect(rows[1].accessUrl).toBe('https://pacs.example.com/x.dcm');
        expect(rows[1].accessUrlExpiresInSeconds).toBeNull();
        await expect(makeService({ role: 'PATIENT' }).svc.listAttachments('r1', 'p1')).rejects.toThrow(ForbiddenException);
    });

    it('getAttachmentAccessUrl: 404 khi không có tệp', async () => {
        const { svc } = makeService({ role: 'LAB_STAFF' });
        expect((await svc.getAttachmentAccessUrl('a1', 'u1')).accessUrl).toContain('signed/');
        await expect(svc.getAttachmentAccessUrl('nope', 'u1')).rejects.toThrow(/Không tìm thấy/);
    });
});
