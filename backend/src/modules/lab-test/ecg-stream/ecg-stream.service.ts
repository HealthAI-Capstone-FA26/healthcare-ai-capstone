import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ECG_SIGNAL_STORAGE, EcgSignalStorage } from '../ecg-recording/ecg-signal-storage.port';
import { getRequiredEcgLeads } from '../ecg-recording/ecg-upload.config';
import { ECG_ANOMALY_PROVIDER, EcgAiError, EcgAnomalyProvider } from '../ecg-ai-analysis/ecg-anomaly-provider.port';
import { ECG_AI_TASK_TYPE } from '../ecg-ai-analysis/ecg-model.service';
import { AnomalyInterval, buildAnomalyFlags } from './ecg-anomaly-labeler';
import { EcgDatasetCatalog, EcgDatasetName } from './ecg-dataset.catalog';
import { EcgSignalFormatError, ParsedEcgSignal, StreamableSignalFormat, isStreamableFormat, parseEcgSignal } from './ecg-signal-reader';
import { EcgStreamError } from './ecg-stream.error';

export { EcgStreamError, EcgStreamErrorCode } from './ecg-stream.error';

export const ECG_STREAM_MIN_SPEED = 0.1;
export const ECG_STREAM_MAX_SPEED = 8;

/** Định dạng nhận khi upload qua socket. */
export const ECG_UPLOAD_STREAM_FORMATS = ['npy', 'csv'] as const;

/** Tên lead mặc định cho tệp không ghi tên lead (npy / csv không header): 2 kênh = I, II. */
const DEFAULT_LEAD_NAMES = ['I', 'II'];

export type EcgStreamSource =
    /** Bản ghi đã lưu trong DB/MinIO (luồng cũ). */
    | { kind: 'recording'; recordingId: string; analysisId?: string }
    /** Tệp .npy/.csv người dùng gửi thẳng qua socket. */
    | { kind: 'upload'; data: Buffer; fileName: string; sampleRateHz: number; leadNames?: string[] }
    /** Dataset có sẵn trên server (ECG_A..ECG_F). */
    | { kind: 'dataset'; name: EcgDatasetName };

export interface EcgStreamRequest {
    source: EcgStreamSource;
    /** Tên (vd 'II') hoặc chỉ số (0-based) của lead cần phát. Mặc định: 'II' nếu có, không thì lead đầu tiên. */
    lead?: string | number;
    /** Phát kèm nhãn anomaly 0/1 (API [2]). */
    withAnomaly: boolean;
    /** Bắt đầu phát từ mili-giây thứ mấy của tín hiệu. */
    startMs?: number;
}

export interface PreparedEcgStream {
    source: EcgStreamSource['kind'];
    /** recordingId | tên tệp upload | 'ECG_A'… */
    sourceName: string;
    recordingId?: string;
    lead: string;
    sampleRateHz: number;
    samples: Float32Array;
    /** Có khi withAnomaly. */
    flags?: Uint8Array;
    /** Chỉ nguồn recording. */
    analysisId?: string;
    /** Kết luận tổng của AI (normal | abnormal | …) — chỉ khi withAnomaly. */
    overallResult?: string;
    totalPoints: number;
    durationMs: number;
    startIndex: number;
    anomalyPointCount?: number;
}

interface RawSignal {
    buffer: Buffer;
    format: StreamableSignalFormat;
    fileName: string;
    sampleRateHz: number;
    leadNames: string[];
    /** Gợi ý số lead để đoán chiều mảng 2D. */
    numLeadsHint?: number;
}

interface Detection {
    events: AnomalyInterval[];
    overallResult: string;
    analysisId?: string;
}

const AI_ERROR_MESSAGES: Record<string, string> = {
    AI_NOT_CONFIGURED: 'Chưa cấu hình dịch vụ AI phát hiện bất thường (ECG_AI_BASE_URL).',
    AI_TIMEOUT: 'Dịch vụ AI không phản hồi kịp thời.',
    AI_UNAVAILABLE: 'Không kết nối được dịch vụ AI.',
    AI_INVALID_RESPONSE: 'Dịch vụ AI trả về dữ liệu không hợp lệ.',
};

const MAX_CACHE_ENTRIES = 50;

/**
 * Chuẩn bị dữ liệu để stream: lấy tín hiệu từ 1 trong 3 nguồn (upload · dataset ECG_A..F · bản ghi đã lưu), chọn lead và
 * (API [2]) dựng nhãn anomaly 0/1:
 *   - nguồn recording : lấy các đoạn bất thường đã lưu của EcgAiAnalysis;
 *   - nguồn upload/dataset : KHÔNG có trong DB -> gọi dịch vụ AI (POST /v1/ecg/analyze) ngay lúc này, lấy các đoạn bất
 *     thường model trả về. Kết quả của dataset được cache theo (tệp, model) vì tín hiệu cố định.
 * Việc phân quyền (JWT + vai trò) do gateway làm; service chỉ lo dữ liệu.
 */
@Injectable()
export class EcgStreamService {
    private readonly logger = new Logger(EcgStreamService.name);
    private readonly datasetDetections = new Map<string, Detection>();

    constructor(
        private readonly prisma: PrismaService,
        @Inject(ECG_SIGNAL_STORAGE) private readonly storage: EcgSignalStorage,
        @Inject(ECG_ANOMALY_PROVIDER) private readonly provider: EcgAnomalyProvider,
        private readonly datasets: EcgDatasetCatalog,
    ) {}

    listDatasets() {
        return this.datasets.list();
    }

    async prepare(req: EcgStreamRequest): Promise<PreparedEcgStream> {
        const { source } = req;
        let raw: RawSignal;
        let sourceName: string;
        let datasetVersion: string | undefined;
        let detection: Detection | undefined;

        if (source.kind === 'recording') {
            const rec = await this.loadRecording(source.recordingId);
            // Kiểm tra analysis TRƯỚC khi tải tệp lớn: lỗi rẻ thì báo sớm.
            if (req.withAnomaly) detection = await this.loadStoredAnalysis(source.recordingId, source.analysisId);
            raw = { ...rec, buffer: await this.readStored(source.recordingId, rec.objectName) };
            sourceName = source.recordingId;
        } else if (source.kind === 'upload') {
            raw = this.fromUpload(source);
            sourceName = source.fileName;
        } else {
            const d = await this.datasets.load(source.name);
            raw = { buffer: d.buffer, format: d.format, fileName: d.fileName, sampleRateHz: d.sampleRateHz, leadNames: DEFAULT_LEAD_NAMES, numLeadsHint: getRequiredEcgLeads() || undefined };
            sourceName = source.name;
            datasetVersion = d.version;
        }

        const parsed = this.parse(raw);
        // Tên lead ưu tiên theo metadata khi số lead khớp (cùng thứ tự cột với AI đã phân tích).
        const names = raw.leadNames.length === parsed.leads.length ? raw.leadNames : parsed.leadNames;
        const idx = this.pickLead(req.lead, names);
        const samples = parsed.leads[idx];
        const sampleRateHz = raw.sampleRateHz;

        if (req.withAnomaly && !detection) detection = await this.detect(raw, parsed, names, sourceName, datasetVersion);

        const startIndex = req.startMs && req.startMs > 0 ? Math.min(samples.length, Math.ceil((req.startMs * sampleRateHz) / 1000)) : 0;
        const prepared: PreparedEcgStream = {
            source: source.kind,
            sourceName,
            lead: names[idx],
            sampleRateHz,
            samples,
            totalPoints: samples.length,
            durationMs: Math.round((samples.length * 1000) / sampleRateHz),
            startIndex,
        };
        if (source.kind === 'recording') prepared.recordingId = source.recordingId;
        if (detection) {
            prepared.flags = buildAnomalyFlags(samples.length, sampleRateHz, detection.events);
            prepared.anomalyPointCount = prepared.flags.reduce((n, f) => n + f, 0);
            prepared.overallResult = detection.overallResult;
            if (detection.analysisId) prepared.analysisId = detection.analysisId;
        }
        return prepared;
    }

    // ---------------------------------------------------------------------------------------------------------
    // Nguồn tín hiệu
    // ---------------------------------------------------------------------------------------------------------

    private fromUpload(src: Extract<EcgStreamSource, { kind: 'upload' }>): RawSignal {
        const ext = /\.([a-z0-9]+)$/i.exec(src.fileName)?.[1]?.toLowerCase();
        if (!ext || !(ECG_UPLOAD_STREAM_FORMATS as readonly string[]).includes(ext)) {
            throw new EcgStreamError('UNSUPPORTED_FILE_TYPE', `Chỉ nhận tệp ${ECG_UPLOAD_STREAM_FORMATS.map((f) => '.' + f).join(' hoặc ')} (nhận '${ext ? '.' + ext : 'không có phần mở rộng'}').`);
        }
        return {
            buffer: src.data,
            format: ext as StreamableSignalFormat,
            fileName: src.fileName,
            sampleRateHz: src.sampleRateHz,
            leadNames: src.leadNames?.length ? src.leadNames : DEFAULT_LEAD_NAMES,
            numLeadsHint: getRequiredEcgLeads() || undefined,
        };
    }

    private async loadRecording(recordingId: string) {
        const recording = await this.prisma.ecgRecording.findUnique({
            where: { ecgRecordingId: recordingId },
            select: { status: true, signalFileUrl: true, signalFormat: true, sampleRateHz: true, numLeads: true, leadNames: true },
        });
        if (!recording) throw new EcgStreamError('RECORDING_NOT_FOUND', `Không tìm thấy bản ghi ECG ${recordingId}`);
        if (recording.status !== 'completed' || !recording.signalFileUrl) {
            throw new EcgStreamError('RECORDING_NOT_READY', `Bản ghi chưa sẵn sàng để phát (trạng thái '${recording.status}').`);
        }
        if (!isStreamableFormat(recording.signalFormat)) {
            throw new EcgStreamError('SIGNAL_FORMAT_NOT_STREAMABLE', `Định dạng '${recording.signalFormat}' chưa hỗ trợ stream (hỗ trợ: csv, json, npy).`);
        }
        return {
            objectName: recording.signalFileUrl,
            format: recording.signalFormat,
            fileName: recording.signalFileUrl.split('/').pop() ?? recording.signalFileUrl,
            sampleRateHz: recording.sampleRateHz,
            leadNames: recording.leadNames,
            numLeadsHint: recording.numLeads,
        };
    }

    private async readStored(recordingId: string, objectName: string): Promise<Buffer> {
        try {
            return await this.storage.get(objectName);
        } catch (err) {
            this.logger.error(`Đọc tín hiệu ECG thất bại (recording ${recordingId}): ${(err as Error).message}`);
            throw new EcgStreamError('SIGNAL_LOAD_FAILED', 'Không đọc được tệp tín hiệu từ kho lưu trữ.');
        }
    }

    private parse(raw: RawSignal): ParsedEcgSignal {
        try {
            return parseEcgSignal(raw.format, raw.buffer, { leadNames: raw.leadNames, numLeads: raw.numLeadsHint });
        } catch (err) {
            if (err instanceof EcgSignalFormatError) throw new EcgStreamError(err.code, err.message);
            throw err;
        }
    }

    private pickLead(lead: string | number | undefined, names: string[]): number {
        if (lead === undefined || lead === '') {
            const ii = names.findIndex((n) => n.toUpperCase() === 'II');
            return ii >= 0 ? ii : 0;
        }
        if (typeof lead === 'number' || /^\d+$/.test(lead)) {
            const i = Number(lead);
            if (Number.isInteger(i) && i >= 0 && i < names.length) return i;
        } else {
            const i = names.findIndex((n) => n.toLowerCase() === lead.toLowerCase());
            if (i >= 0) return i;
        }
        throw new EcgStreamError('LEAD_NOT_FOUND', `Không có lead '${lead}'. Lead khả dụng: ${names.join(', ')}.`);
    }

    // ---------------------------------------------------------------------------------------------------------
    // Nhãn anomaly
    // ---------------------------------------------------------------------------------------------------------

    /** Nguồn recording: dùng kết quả AI đã lưu (analysis completed, isCurrent hoặc theo analysisId). */
    private async loadStoredAnalysis(ecgRecordingId: string, analysisId?: string): Promise<Detection> {
        const analysis = await this.prisma.ecgAiAnalysis.findFirst({
            where: analysisId ? { analysisId, ecgRecordingId, status: 'completed' } : { ecgRecordingId, isCurrent: true, status: 'completed' },
            select: { analysisId: true, overallResult: true, events: { select: { startOffsetMs: true, endOffsetMs: true } } },
        });
        if (!analysis) {
            throw new EcgStreamError('ANALYSIS_NOT_READY', 'Bản ghi chưa có kết quả phân tích AI hoàn tất — chưa thể gắn nhãn anomaly.');
        }
        return { events: analysis.events, overallResult: analysis.overallResult ?? 'unknown', analysisId: analysis.analysisId };
    }

    /** Nguồn upload/dataset: gọi dịch vụ AI lấy các đoạn bất thường. */
    private async detect(raw: RawSignal, parsed: ParsedEcgSignal, names: string[], sourceName: string, datasetVersion?: string): Promise<Detection> {
        const required = getRequiredEcgLeads();
        if (required > 0 && parsed.leads.length !== required) {
            throw new EcgStreamError('LEAD_COUNT_MISMATCH', `Model AI chỉ phân tích tín hiệu ${required} lead (tệp có ${parsed.leads.length}).`);
        }
        if (!this.provider.isConfigured()) throw new EcgStreamError('AI_NOT_CONFIGURED', AI_ERROR_MESSAGES.AI_NOT_CONFIGURED);

        const model = await this.prisma.aiModelVersion.findFirst({
            where: { taskType: ECG_AI_TASK_TYPE, status: 'active' },
            orderBy: [{ deployedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
            select: { modelName: true, version: true },
        });
        if (!model) throw new EcgStreamError('AI_MODEL_NOT_FOUND', "Chưa có model AI 'active' cho phân tích bất thường ECG.");

        const cacheKey = datasetVersion ? `${sourceName}|${datasetVersion}|${model.modelName}@${model.version}` : undefined;
        const cached = cacheKey ? this.datasetDetections.get(cacheKey) : undefined;
        if (cached) return cached;

        const numSamples = parsed.leads[0].length;
        let result;
        try {
            result = await this.provider.analyze({
                recordingId: `adhoc-${sourceName}`,
                signal: raw.buffer,
                fileName: raw.fileName,
                signalFormat: raw.format,
                sampleRateHz: raw.sampleRateHz,
                numLeads: parsed.leads.length,
                leadNames: names,
                durationMs: Math.round((numSamples * 1000) / raw.sampleRateHz),
                model: { name: model.modelName, version: model.version },
                options: {},
            });
        } catch (err) {
            if (err instanceof EcgAiError) {
                this.logger.error(`AI phân tích '${sourceName}' thất bại [${err.code}]: ${err.message}`);
                throw new EcgStreamError(err.code, AI_ERROR_MESSAGES[err.code] ?? `Dịch vụ AI gặp sự cố (${err.code}).`);
            }
            throw err;
        }

        const detection: Detection = { events: result.anomalies, overallResult: result.overallResult };
        if (cacheKey) {
            if (this.datasetDetections.size >= MAX_CACHE_ENTRIES) this.datasetDetections.clear();
            this.datasetDetections.set(cacheKey, detection);
        }
        return detection;
    }
}
