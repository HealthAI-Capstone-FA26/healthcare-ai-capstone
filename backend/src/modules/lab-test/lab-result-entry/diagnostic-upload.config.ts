import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { BUCKET_NAME, minioClient } from '../../../common/configs/upload.config';

/**
 * Cấu hình upload RIÊNG của lab-test cho tệp đính kèm kết quả cận lâm sàng. Không sửa common/configs/upload.config.ts
 * (shared, chỉ nhận ảnh <= 5MB) — kết quả cận lâm sàng cần thêm PDF, DICOM, video cine-loop và dung lượng lớn hơn.
 */
export const DIAGNOSTIC_UPLOAD_MAX_BYTES = 50 * 1024 * 1024; // 50MB
export const DIAGNOSTIC_ALLOWED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
    'application/dicom',
    'video/mp4',
    'video/webm',
    'text/csv',
    'application/json',
    'application/octet-stream', // DICOM/raw export nhiều máy không khai báo MIME chuẩn
];

export const diagnosticUploadConfig = {
    storage: memoryStorage(),
    limits: { fileSize: DIAGNOSTIC_UPLOAD_MAX_BYTES },
    fileFilter: (_req: unknown, file: Express.Multer.File, callback: (err: Error | null, accept: boolean) => void) => {
        if (DIAGNOSTIC_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            callback(null, true);
        } else {
            callback(
                new BadRequestException(`Định dạng không hỗ trợ. Chỉ nhận: ${DIAGNOSTIC_ALLOWED_MIME_TYPES.join(', ')}`),
                false,
            );
        }
    },
};

export async function uploadDiagnosticFile(
    file: Express.Multer.File,
    folder: string,
): Promise<{ bucket: string; objectName: string }> {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const objectName = `${folder}/${uniqueSuffix}${extname(file.originalname)}`;
    await minioClient.putObject(BUCKET_NAME, objectName, file.buffer, file.size, { 'Content-Type': file.mimetype });
    return { bucket: BUCKET_NAME, objectName };
}

/** Thời hạn presigned URL xem/tải ảnh y khoa (giây). Ngắn để URL bị lộ cũng nhanh hết hiệu lực. */
export const DIAGNOSTIC_URL_EXPIRY_SECONDS = 15 * 60;

/** fileUrl là URL tuyệt đối của hệ thống khác (không phải object key trong bucket của mình). */
export function isExternalUrl(fileUrl: string): boolean {
    return /^https?:\/\//i.test(fileUrl);
}

/** Presigned GET URL cho 1 object key trong bucket. */
export async function presignDiagnosticFile(objectName: string, expirySeconds = DIAGNOSTIC_URL_EXPIRY_SECONDS): Promise<string> {
    return minioClient.presignedGetObject(BUCKET_NAME, objectName, expirySeconds);
}

const FILE_TYPE_MIME_RULES: Record<string, (mime: string) => boolean> = {
    image: (m) => m.startsWith('image/'),
    video: (m) => m.startsWith('video/'),
    pdf: (m) => m === 'application/pdf',
    dicom: (m) => m === 'application/dicom' || m === 'application/octet-stream',
};

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
    buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

/**
 * Kiểm tra NỘI DUNG thật của tệp (magic bytes), không tin MIME do client khai báo.
 * Ngăn việc đẩy file thực thi/script vào kho ảnh y khoa bằng cách đổi đuôi/MIME.
 * Ném BadRequestException nếu nội dung không khớp MIME/fileType.
 */
export function assertFileSignature(file: Pick<Express.Multer.File, 'buffer' | 'mimetype' | 'originalname'>, fileType: string): void {
    const { buffer: buf, mimetype: mime } = file;
    const fail = (why: string): never => {
        throw new BadRequestException(`Tệp '${file.originalname}' không hợp lệ: ${why}`);
    };

    if (!buf || buf.length < 16) fail('tệp rỗng hoặc quá nhỏ.');

    const rule = FILE_TYPE_MIME_RULES[fileType];
    if (rule && !rule(mime)) fail(`fileType='${fileType}' không khớp MIME '${mime}'.`);

    switch (mime) {
        case 'image/jpeg':
            if (!startsWith(buf, [0xff, 0xd8, 0xff])) fail('nội dung không phải JPEG.');
            break;
        case 'image/png':
            if (!startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) fail('nội dung không phải PNG.');
            break;
        case 'image/webp':
            if (!startsWith(buf, [0x52, 0x49, 0x46, 0x46]) || !startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) fail('nội dung không phải WebP.');
            break;
        case 'application/pdf':
            if (!buf.subarray(0, 1024).includes('%PDF-')) fail('nội dung không phải PDF.');
            break;
        case 'video/mp4':
            if (!startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4)) fail('nội dung không phải MP4.');
            break;
        case 'video/webm':
            if (!startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) fail('nội dung không phải WebM.');
            break;
        case 'application/dicom':
            if (!startsWith(buf, [0x44, 0x49, 0x43, 0x4d], 128)) fail("thiếu dấu 'DICM' của tệp DICOM.");
            break;
        case 'application/octet-stream':
            if (fileType === 'dicom') {
                if (!startsWith(buf, [0x44, 0x49, 0x43, 0x4d], 128)) fail("thiếu dấu 'DICM' của tệp DICOM.");
            } else if (fileType !== 'raw_export') {
                fail("MIME 'application/octet-stream' chỉ chấp nhận cho fileType 'dicom' hoặc 'raw_export'.");
            }
            break;
        case 'text/csv':
        case 'application/json':
            if (buf.subarray(0, 1024).includes(0)) fail('nội dung nhị phân, không phải văn bản.');
            break;
        default:
            fail(`MIME '${mime}' chưa được hỗ trợ.`);
    }

    // Từ chối tệp thực thi giả dạng (PE/ELF/script shebang) ở mọi định dạng
    if (startsWith(buf, [0x4d, 0x5a]) || startsWith(buf, [0x7f, 0x45, 0x4c, 0x46]) || startsWith(buf, [0x23, 0x21])) {
        fail('phát hiện tệp thực thi.');
    }
}
