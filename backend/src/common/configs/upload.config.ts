import 'dotenv/config';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { BadRequestException, Logger } from '@nestjs/common';
import type { Readable } from 'stream';
import {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadBucketCommand,
    CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const logger = new Logger('MinioSetup');

// 1. Khởi tạo S3 Client (AWS SDK) — chạy được với Supabase Storage, Cloudflare R2, MinIO...
// Endpoint phải là URL đầy đủ (gồm cả đường dẫn), vd Supabase: https://<ref>.storage.supabase.co/storage/v1/s3
// Không đặt S3_ENDPOINT thì ghép từ MINIO_ENDPOINT/MINIO_PORT/MINIO_USE_SSL như cũ (chạy MinIO local).
const resolveEndpoint = (): string => {
    if (process.env.S3_ENDPOINT) return process.env.S3_ENDPOINT;
    const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http';
    return `${protocol}://${process.env.MINIO_ENDPOINT || 'localhost'}:${process.env.MINIO_PORT || '9000'}`;
};

const s3 = new S3Client({
    endpoint: resolveEndpoint(),
    region: process.env.S3_REGION || 'us-east-1', // Supabase: điền đúng region của project
    forcePathStyle: true, // bắt buộc với Supabase/MinIO (dạng endpoint/bucket/key)
    credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY || 'minioadmin',
        secretAccessKey: process.env.MINIO_SECRET_KEY || '12345678',
    },
});

// Giữ nguyên tên `minioClient` + chữ ký các hàm để các module khác (lab-test, payment) không phải sửa.
export const minioClient = {
    async putObject(
        bucket: string,
        objectName: string,
        body: Buffer,
        _size?: number,
        meta?: Record<string, string>,
    ): Promise<void> {
        await s3.send(
            new PutObjectCommand({
                Bucket: bucket,
                Key: objectName,
                Body: body,
                ContentLength: body.length,
                ContentType: meta?.['Content-Type'],
            }),
        );
    },

    async getObject(bucket: string, objectName: string): Promise<Readable> {
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: objectName }));
        return res.Body as Readable;
    },

    async removeObject(bucket: string, objectName: string): Promise<void> {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectName }));
    },

    presignedGetObject(bucket: string, objectName: string, expirySeconds = 900): Promise<string> {
        return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: objectName }), {
            expiresIn: expirySeconds,
        });
    },
};

export const BUCKET_NAME = process.env.MINIO_BUCKET || 'app-uploads';

/** Các thư mục (prefix) trong bucket được phép đọc công khai. Thêm thư mục mới vào đây MỘT cách có chủ đích. */
export const PUBLIC_READ_PREFIXES = ['avatars', 'images'] as const;

export const buildPublicReadPolicy = (bucket: string) => ({
    Version: '2012-10-17',
    Statement: [
        {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: PUBLIC_READ_PREFIXES.map((prefix) => `arn:aws:s3:::${bucket}/${prefix}/*`),
        },
    ],
});

// 2. Hàm kiểm tra kết nối & tự tạo Bucket nếu chưa có (chỉ có tác dụng với MinIO local)
export const checkMinioConnection = async (): Promise<boolean> => {
    try {
        try {
            await s3.send(new HeadBucketCommand({ Bucket: BUCKET_NAME }));
            logger.log(`Bucket exists: ${BUCKET_NAME}`);
        } catch (error) {
            // Bucket chưa có -> tạo mới; lỗi khác (sai key, sai endpoint...) thì ném tiếp
            const name = error instanceof Error ? error.name : '';
            if (name !== 'NotFound' && name !== 'NoSuchBucket') throw error;
            await s3.send(new CreateBucketCommand({ Bucket: BUCKET_NAME }));
            logger.log(`Created bucket: ${BUCKET_NAME}`);
        }

        // KHÔNG còn gọi setBucketPolicy: Supabase/R2 không cho đặt policy theo prefix.
        // Quyền đọc công khai được bật ở mức bucket trên dashboard (Supabase: bucket > Public bucket).
        logger.log('Connect to S3 storage successfully!');
        return true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to connect to S3 storage: ${errorMessage}`);
        return false;
    }
};

// 3. Cấu hình Multer & Helper Upload
export const UPLOAD_CONSTANTS = {
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB
    ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
};

export const imageUploadConfig = {
    storage: memoryStorage(),
    limits: {
        fileSize: UPLOAD_CONSTANTS.MAX_FILE_SIZE,
    },
    fileFilter: (req: any, file: Express.Multer.File, callback: any) => {
        if (UPLOAD_CONSTANTS.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            callback(null, true);
        } else {
            callback(
                new BadRequestException(
                    `Định dạng không hỗ trợ. Chỉ nhận: ${UPLOAD_CONSTANTS.ALLOWED_MIME_TYPES.join(', ')}`,
                ),
                false,
            );
        }
    },
};

export const uploadImageToS3 = async (
    file: Express.Multer.File,
    folder = 'images',
): Promise<{ bucket: string; objectName: string }> => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = extname(file.originalname);
    const objectName = `${folder}/${uniqueSuffix}${ext}`;

    await minioClient.putObject(
        BUCKET_NAME,
        objectName,
        file.buffer,
        file.size,
        { 'Content-Type': file.mimetype },
    );

    return { bucket: BUCKET_NAME, objectName };
};

export const deleteFileFromS3 = async (objectName: string): Promise<void> => {
    try {
        if (!objectName) return;
        await minioClient.removeObject(BUCKET_NAME, objectName);
        logger.log(`Deleted object from MinIO: ${objectName}`);
    } catch (error) {
        logger.error(`Failed to delete object ${objectName} from MinIO`, error);
    }
};
