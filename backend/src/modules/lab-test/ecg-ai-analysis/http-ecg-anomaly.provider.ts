import {
    ECG_OVERALL_RESULTS,
    ECG_SEVERITIES,
    EcgAiError,
    EcgAnalyzeInput,
    EcgAnalyzeMetadata,
    EcgAnalyzeResult,
    EcgAnomalyProvider,
    EcgDetectedAnomaly,
    EcgOverallResult,
    EcgSeverity,
} from './ecg-anomaly-provider.port';

export interface HttpEcgProviderConfig {
    baseUrl?: string;
    timeoutMs: number;
    apiKey?: string;
}

/** Đọc cấu hình từ biến môi trường: ECG_AI_BASE_URL, ECG_AI_TIMEOUT_MS (mặc định 60000), ECG_AI_API_KEY. */
export function readEcgAiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): HttpEcgProviderConfig {
    const timeout = Number(env.ECG_AI_TIMEOUT_MS);
    return {
        baseUrl: env.ECG_AI_BASE_URL?.trim() || undefined,
        timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 60_000,
        apiKey: env.ECG_AI_API_KEY?.trim() || undefined,
    };
}

const ENDPOINT_PATH = '/v1/ecg/analyze';
const MAX_ERROR_BODY_CHARS = 300;

/**
 * Adapter HTTP gọi dịch vụ Python. KHÔNG phụ thuộc NestJS DI (khởi tạo bằng factory trong module, hoặc trực tiếp
 * trong bộ benchmark). Mọi sự cố -> EcgAiError với code ổn định:
 *   AI_NOT_CONFIGURED (skip) · AI_TIMEOUT · AI_UNAVAILABLE · AI_HTTP_<status> · AI_INVALID_RESPONSE
 */
export class HttpEcgAnomalyProvider implements EcgAnomalyProvider {
    constructor(private readonly config: HttpEcgProviderConfig) {}

    isConfigured(): boolean {
        return !!this.config.baseUrl;
    }

    async analyze(input: EcgAnalyzeInput): Promise<EcgAnalyzeResult> {
        if (!this.config.baseUrl) {
            throw new EcgAiError('AI_NOT_CONFIGURED', 'Chưa cấu hình ECG_AI_BASE_URL — bỏ qua phân tích AI.', true);
        }

        const metadata: EcgAnalyzeMetadata = {
            recordingId: input.recordingId,
            signalFormat: input.signalFormat,
            sampleRateHz: input.sampleRateHz,
            numLeads: input.numLeads,
            leadNames: input.leadNames,
            durationMs: input.durationMs,
            model: input.model,
            options: input.options,
        };
        const form = new FormData();
        form.append('metadata', JSON.stringify(metadata));
        form.append('signal', new Blob([new Uint8Array(input.signal)]), input.fileName);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

        let response: Response;
        try {
            response = await fetch(`${this.config.baseUrl.replace(/\/+$/, '')}${ENDPOINT_PATH}`, {
                method: 'POST',
                body: form,
                headers: this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : undefined,
                signal: controller.signal,
            });
        } catch (err) {
            if ((err as Error)?.name === 'AbortError') {
                throw new EcgAiError('AI_TIMEOUT', `Dịch vụ AI không phản hồi trong ${this.config.timeoutMs}ms.`);
            }
            throw new EcgAiError('AI_UNAVAILABLE', `Không kết nối được dịch vụ AI: ${(err as Error)?.message ?? err}`);
        } finally {
            clearTimeout(timer);
        }

        if (!response.ok) {
            const body = (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY_CHARS);
            throw new EcgAiError(`AI_HTTP_${response.status}`, `Dịch vụ AI trả HTTP ${response.status}: ${body}`);
        }

        let json: unknown;
        try {
            json = await response.json();
        } catch {
            throw new EcgAiError('AI_INVALID_RESPONSE', 'Dịch vụ AI trả về nội dung không phải JSON.');
        }
        return parseAnalyzeResult(json);
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// Kiểm tra chặt phản hồi: không tin dữ liệu từ dịch vụ ngoài trước khi ghi DB.
// ---------------------------------------------------------------------------------------------------------------------

const invalid = (msg: string): never => {
    throw new EcgAiError('AI_INVALID_RESPONSE', `Phản hồi AI không hợp lệ: ${msg}`);
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function nullableNumber(obj: Record<string, unknown>, key: string, min: number, max: number): number | null {
    const v = obj[key];
    if (v === undefined || v === null) return null;
    if (!num(v) || v < min || v > max) invalid(`'${key}' phải là số trong [${min}, ${max}] hoặc null`);
    return v as number;
}

function nullableInt(obj: Record<string, unknown>, key: string, min: number, max: number): number | null {
    const v = nullableNumber(obj, key, min, max);
    if (v !== null && !Number.isInteger(v)) invalid(`'${key}' phải là số nguyên`);
    return v;
}

function nullableObject(obj: Record<string, unknown>, key: string): Record<string, unknown> | null {
    const v = obj[key];
    if (v === undefined || v === null) return null;
    if (!isObj(v)) invalid(`'${key}' phải là object hoặc null`);
    return v as Record<string, unknown>;
}

export function parseAnalyzeResult(raw: unknown): EcgAnalyzeResult {
    if (!isObj(raw)) return invalid('gốc phải là object');

    const overall = raw.overallResult;
    if (typeof overall !== 'string' || !(ECG_OVERALL_RESULTS as readonly string[]).includes(overall)) {
        invalid(`'overallResult' phải thuộc ${ECG_OVERALL_RESULTS.join('|')}`);
    }

    const rawAnomalies = raw.anomalies ?? [];
    if (!Array.isArray(rawAnomalies)) invalid("'anomalies' phải là mảng");

    const anomalies: EcgDetectedAnomaly[] = (rawAnomalies as unknown[]).map((a, i) => {
        if (!isObj(a)) return invalid(`anomalies[${i}] phải là object`);
        if (!num(a.score) || a.score < 0 || a.score > 1) invalid(`anomalies[${i}].score phải trong [0,1]`);
        if (typeof a.severity !== 'string' || !(ECG_SEVERITIES as readonly string[]).includes(a.severity)) {
            invalid(`anomalies[${i}].severity phải thuộc ${ECG_SEVERITIES.join('|')}`);
        }
        if (!Number.isInteger(a.startOffsetMs) || !Number.isInteger(a.endOffsetMs) || (a.startOffsetMs as number) < 0 || (a.endOffsetMs as number) < (a.startOffsetMs as number)) {
            invalid(`anomalies[${i}] cần startOffsetMs/endOffsetMs nguyên, 0 <= start <= end`);
        }
        const type = a.anomalyType ?? null;
        if (type !== null && (typeof type !== 'string' || type.length === 0 || type.length > 40)) {
            invalid(`anomalies[${i}].anomalyType phải là chuỗi 1-40 ký tự hoặc null`);
        }
        const leads = a.affectedLeads ?? [];
        if (!Array.isArray(leads) || leads.some((l) => typeof l !== 'string')) invalid(`anomalies[${i}].affectedLeads phải là mảng chuỗi`);

        return {
            anomalyType: type as string | null,
            score: a.score as number,
            severity: a.severity as EcgSeverity,
            startOffsetMs: a.startOffsetMs as number,
            endOffsetMs: a.endOffsetMs as number,
            affectedLeads: leads as string[],
            heartRateBpm: nullableInt(a, 'heartRateBpm', 1, 400),
            details: nullableObject(a, 'details'),
        };
    });

    return {
        overallResult: overall as EcgOverallResult,
        maxAnomalyScore: nullableNumber(raw, 'maxAnomalyScore', 0, 1),
        thresholdUsed: nullableNumber(raw, 'thresholdUsed', 0, 1),
        windowMs: nullableInt(raw, 'windowMs', 1, 3_600_000),
        strideMs: nullableInt(raw, 'strideMs', 1, 3_600_000),
        signalQuality: nullableNumber(raw, 'signalQuality', 0, 1),
        summaryMetrics: nullableObject(raw, 'summaryMetrics'),
        inferenceLatencyMs: nullableInt(raw, 'inferenceLatencyMs', 0, 3_600_000),
        anomalies,
    };
}
