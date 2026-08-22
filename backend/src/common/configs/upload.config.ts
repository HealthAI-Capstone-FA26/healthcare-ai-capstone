import { memoryStorage } from 'multer';
import { extname } from 'path';
import { BadRequestException, Logger } from '@nestjs/common';
import * as Minio from 'minio';

const logger = new Logger('MinioSetup');

// 1. Khởi tạo MinIO Client
export const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || 'localhost',
    port: parseInt(process.env.MINIO_PORT || '9000', 10),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.MINIO_SECRET_KEY || '12345678',
});

export const BUCKET_NAME = process.env.MINIO_BUCKET || 'app-uploads';

// 2. Hàm kiểm tra kết nối & tự động tạo Bucket nếu chưa có
export const checkMinioConnection = async (): Promise<boolean> => {
    try {
        const exists = await minioClient.bucketExists(BUCKET_NAME);
        if (!exists) {
            await minioClient.makeBucket(BUCKET_NAME);
            logger.log(`Created bucket: ${BUCKET_NAME}`);
        } else {
            logger.log(`Bucket exists: ${BUCKET_NAME}`);
        }
        logger.log('Connect to MinIO S3 successfully!');
        return true;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error(`Failed to connect to MinIO S3: ${errorMessage}`);
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