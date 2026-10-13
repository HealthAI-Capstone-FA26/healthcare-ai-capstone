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
