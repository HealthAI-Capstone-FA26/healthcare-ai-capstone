import { memoryStorage } from 'multer';

/**
 * Upload tín hiệu ECG: dung lượng tối đa 50MB; KHÔNG lọc theo MIME (trình duyệt/thiết bị báo MIME không nhất quán
 * với .edf/.dcm/.scp). Định dạng được kiểm theo PHẦN MỞ RỘNG so với `signalFormat` trong EcgRecordingService.
 */
export const ECG_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

export const ecgUploadConfig = {
    storage: memoryStorage(),
    limits: { fileSize: ECG_UPLOAD_MAX_BYTES },
};

/** Phần mở rộng hợp lệ cho từng signalFormat. WFDB gồm nhiều tệp (.hea + .dat) nên bắt buộc nén .zip. */
export const ECG_FORMAT_EXTENSIONS: Record<string, string[]> = {
    csv: ['.csv'],
    json: ['.json'],
    npy: ['.npy'],
    edf: ['.edf'],
    wfdb: ['.zip'],
    dicom_ecg: ['.dcm', '.dicom'],
    scp_ecg: ['.scp'],
};

/**
 * Số lead bắt buộc của bản ghi tải lên (model AI được finetune trên 2 kênh). Env ECG_REQUIRED_LEADS; 0 = không ép.
 * Đọc lúc gọi (không cache ở import) để test đổi được bằng process.env.
 */
export function getRequiredEcgLeads(env: NodeJS.ProcessEnv = process.env): number {
    const raw = env.ECG_REQUIRED_LEADS;
    if (raw === undefined || raw.trim() === '') return 2;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : 2;
}
