import { Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { ECG_UPLOAD_MAX_BYTES } from '../ecg-recording/ecg-upload.config';
import { EcgStreamError } from './ecg-stream.error';
import { StreamableSignalFormat } from './ecg-signal-reader';
import { getDatasetDir, getDefaultDatasetSampleRateHz } from './ecg-stream.config';

/** Dataset có sẵn trên server để người dùng chọn (không cần upload). */
export const ECG_DATASET_NAMES = ['ECG_A', 'ECG_B', 'ECG_C', 'ECG_D', 'ECG_E', 'ECG_F'] as const;
export type EcgDatasetName = (typeof ECG_DATASET_NAMES)[number];

/** Chuẩn hoá 'ecg_a' -> 'ECG_A'; null nếu không thuộc danh mục (chặn luôn path traversal vì chỉ nhận 6 tên cố định). */
export function normalizeDatasetName(input: unknown): EcgDatasetName | null {
    if (typeof input !== 'string') return null;
    const up = input.trim().toUpperCase();
    return (ECG_DATASET_NAMES as readonly string[]).includes(up) ? (up as EcgDatasetName) : null;
}

export interface LoadedDataset {
    name: EcgDatasetName;
    buffer: Buffer;
    format: StreamableSignalFormat;
    fileName: string;
    sampleRateHz: number;
    /** mtime+size — dùng làm khoá cache kết quả AI; đổi tệp thì khoá đổi. */
    version: string;
}

/**
 * Tìm tệp của dataset theo thứ tự ưu tiên (đúng bố cục thư mục train `ECG_A/ECG_test.npy` trước):
 *   <dir>/ECG_A/ECG_test.npy · <dir>/ECG_A/ECG_test.csv · <dir>/ECG_A.npy · <dir>/ECG_A.csv
 * Tuỳ chọn <dir>/ECG_A/meta.json { "sampleRateHz": 100 } ghi đè tần số lấy mẫu mặc định cho riêng dataset đó.
 */
@Injectable()
export class EcgDatasetCatalog {
    private readonly logger = new Logger(EcgDatasetCatalog.name);

    private candidates(name: EcgDatasetName): { path: string; format: StreamableSignalFormat; fileName: string }[] {
        const dir = getDatasetDir();
        return [
            { path: join(dir, name, 'ECG_test.npy'), format: 'npy', fileName: `${name}.npy` },
            { path: join(dir, name, 'ECG_test.csv'), format: 'csv', fileName: `${name}.csv` },
            { path: join(dir, `${name}.npy`), format: 'npy', fileName: `${name}.npy` },
            { path: join(dir, `${name}.csv`), format: 'csv', fileName: `${name}.csv` },
        ];
    }

    private async findFile(name: EcgDatasetName) {
        for (const c of this.candidates(name)) {
            try {
                const st = await fs.stat(c.path);
                if (st.isFile()) return { ...c, size: st.size, mtimeMs: st.mtimeMs };
            } catch {
                /* thử ứng viên kế tiếp */
            }
        }
        return null;
    }

    private async sampleRateOf(name: EcgDatasetName): Promise<number> {
        try {
            const meta: unknown = JSON.parse(await fs.readFile(join(getDatasetDir(), name, 'meta.json'), 'utf8'));
            const v = (meta as { sampleRateHz?: unknown })?.sampleRateHz;
            if (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 4000) return v;
        } catch {
            /* không có meta.json -> mặc định */
        }
        return getDefaultDatasetSampleRateHz();
    }

    async list(): Promise<{ name: EcgDatasetName; available: boolean; sampleRateHz: number | null }[]> {
        return Promise.all(
            ECG_DATASET_NAMES.map(async (name) => {
                const found = await this.findFile(name);
                return { name, available: !!found, sampleRateHz: found ? await this.sampleRateOf(name) : null };
            }),
        );
    }

    async load(name: EcgDatasetName): Promise<LoadedDataset> {
        const found = await this.findFile(name);
        if (!found) throw new EcgStreamError('DATASET_NOT_AVAILABLE', `Dataset ${name} chưa được cài trên server.`);
        if (found.size > ECG_UPLOAD_MAX_BYTES) throw new EcgStreamError('FILE_TOO_LARGE', `Dataset ${name} vượt quá giới hạn dung lượng.`);
        try {
            const buffer = await fs.readFile(found.path);
            return {
                name,
                buffer,
                format: found.format,
                fileName: found.fileName,
                sampleRateHz: await this.sampleRateOf(name),
                version: `${Math.round(found.mtimeMs)}-${found.size}`,
            };
        } catch (err) {
            this.logger.error(`Đọc dataset ${name} thất bại: ${(err as Error).message}`);
            throw new EcgStreamError('SIGNAL_LOAD_FAILED', `Không đọc được dataset ${name}.`);
        }
    }
}
