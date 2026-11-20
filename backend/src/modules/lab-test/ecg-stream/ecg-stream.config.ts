import { join } from 'path';
import { ECG_UPLOAD_MAX_BYTES } from '../ecg-recording/ecg-upload.config';

const DEFAULT_STREAM_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Dung lượng tối đa của tệp gửi thẳng qua socket (ECG_STREAM_MAX_UPLOAD_BYTES, mặc định 10MB, trần = giới hạn upload
 * bản ghi 50MB). Đọc lúc gọi để test đổi được bằng process.env.
 */
export function getStreamMaxUploadBytes(env: NodeJS.ProcessEnv = process.env): number {
    const n = Number(env.ECG_STREAM_MAX_UPLOAD_BYTES);
    return Number.isInteger(n) && n > 0 ? Math.min(n, ECG_UPLOAD_MAX_BYTES) : DEFAULT_STREAM_UPLOAD_BYTES;
}

/** Thư mục chứa dataset ECG_A..ECG_F (ECG_DATASET_DIR). Mặc định <cwd>/datasets/ecg. */
export function getDatasetDir(env: NodeJS.ProcessEnv = process.env): string {
    return env.ECG_DATASET_DIR?.trim() || join(process.cwd(), 'datasets', 'ecg');
}

/** Tần số lấy mẫu mặc định của dataset (ECG_DATASET_SAMPLE_RATE_HZ, mặc định 100Hz — ECG_A). Có thể ghi đè từng dataset bằng meta.json. */
export function getDefaultDatasetSampleRateHz(env: NodeJS.ProcessEnv = process.env): number {
    const n = Number(env.ECG_DATASET_SAMPLE_RATE_HZ);
    return Number.isFinite(n) && n >= 1 && n <= 4000 ? n : 100;
}
