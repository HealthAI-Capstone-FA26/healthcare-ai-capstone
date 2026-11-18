import { Injectable } from '@nestjs/common';
import { BUCKET_NAME, minioClient } from '../../../common/configs/upload.config';

/**
 * Cổng lưu trữ tín hiệu ECG thô (KHÔNG lưu trong DB — schema chỉ giữ metadata + object key). Tách interface để
 * test không cần MinIO thật và để đổi nơi lưu mà không đụng service.
 */
export const ECG_SIGNAL_STORAGE = 'ECG_SIGNAL_STORAGE';

export interface EcgSignalStorage {
    put(objectName: string, data: Buffer, contentType?: string): Promise<void>;
    get(objectName: string): Promise<Buffer>;
    remove(objectName: string): Promise<void>;
    presignedGetUrl(objectName: string, expirySeconds: number): Promise<string>;
}

@Injectable()
export class MinioEcgSignalStorage implements EcgSignalStorage {
    async put(objectName: string, data: Buffer, contentType = 'application/octet-stream'): Promise<void> {
        await minioClient.putObject(BUCKET_NAME, objectName, data, data.length, { 'Content-Type': contentType });
    }

    async get(objectName: string): Promise<Buffer> {
        const stream = await minioClient.getObject(BUCKET_NAME, objectName);
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(Buffer.from(chunk));
        return Buffer.concat(chunks);
    }

    async remove(objectName: string): Promise<void> {
        await minioClient.removeObject(BUCKET_NAME, objectName);
    }

    async presignedGetUrl(objectName: string, expirySeconds: number): Promise<string> {
        return minioClient.presignedGetObject(BUCKET_NAME, objectName, expirySeconds);
    }
}
