/**
 * HỢP ĐỒNG giữa backend NestJS và dịch vụ AI phát hiện bất thường ECG (Python). Backend KHÔNG biết model chạy thế nào —
 * chỉ biết cổng này. Mọi lỗi của AI phải được biểu diễn bằng EcgAiError để quy trình thủ công không bị chặn (NFR).
 *
 * HTTP (xem HttpEcgAnomalyProvider):  POST {ECG_AI_BASE_URL}/v1/ecg/analyze   (multipart/form-data)
 *   - field `metadata` : JSON của EcgAnalyzeMetadata (bên dưới)
 *   - field `signal`   : tệp tín hiệu gốc (csv | json | edf | wfdb(.zip) | dicom_ecg | scp_ecg)
 *   - header           : Authorization: Bearer <ECG_AI_API_KEY>  (nếu có cấu hình)
 *   - trả 200 + JSON EcgAnalyzeResult.
 */

export const ECG_ANOMALY_PROVIDER = 'ECG_ANOMALY_PROVIDER';

export const ECG_OVERALL_RESULTS = ['normal', 'abnormal', 'inconclusive', 'poor_signal'] as const;
export type EcgOverallResult = (typeof ECG_OVERALL_RESULTS)[number];

export const ECG_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type EcgSeverity = (typeof ECG_SEVERITIES)[number];

/** Gửi kèm tệp tín hiệu (field `metadata`). */
export interface EcgAnalyzeMetadata {
    recordingId: string;
    signalFormat: string;
    sampleRateHz: number;
    numLeads: number;
    leadNames: string[];
    durationMs: number | null;
    model: { name: string; version: string };
    /** Tuỳ chọn cho model; bỏ trống = dùng mặc định của model. */
    options: { threshold?: number; windowMs?: number; strideMs?: number };
}

export interface EcgAnalyzeInput extends Omit<EcgAnalyzeMetadata, 'recordingId'> {
    recordingId: string;
    signal: Buffer;
    fileName: string;
}

/** 1 đoạn tín hiệu bất thường. */
export interface EcgDetectedAnomaly {
    /** afib | pvc | pac | vt | bradycardia | tachycardia | st_elevation | st_depression | av_block | unclassified; null nếu model unsupervised */
    anomalyType: string | null;
    /** 0..1 (đã chuẩn hoá) */
    score: number;
    severity: EcgSeverity;
    /** mili-giây tính từ đầu recording */
    startOffsetMs: number;
    endOffsetMs: number;
    affectedLeads: string[];
    heartRateBpm: number | null;
    /** điểm theo từng lead, vị trí đỉnh R, saliency... (JSON tự do) */
    details: Record<string, unknown> | null;
}

export interface EcgAnalyzeResult {
    overallResult: EcgOverallResult;
    /** điểm bất thường lớn nhất 0..1; null nếu không áp dụng */
    maxAnomalyScore: number | null;
    thresholdUsed: number | null;
    windowMs: number | null;
    strideMs: number | null;
    /** chỉ số chất lượng tín hiệu 0..1 */
    signalQuality: number | null;
    /** {hrMean, hrMin, hrMax, abnormalDurationMs, ...} */
    summaryMetrics: Record<string, unknown> | null;
    inferenceLatencyMs: number | null;
    anomalies: EcgDetectedAnomaly[];
}

export interface EcgAnomalyProvider {
    /** false khi chưa cấu hình dịch vụ AI -> analysis 'skipped' (không phải lỗi). */
    isConfigured(): boolean;
    analyze(input: EcgAnalyzeInput): Promise<EcgAnalyzeResult>;
}

/**
 * Lỗi của lớp AI. `code` lưu vào EcgAiAnalysis.errorCode; `skip=true` -> status 'skipped' thay vì 'failed'.
 */
export class EcgAiError extends Error {
    constructor(
        public readonly code: string,
        message: string,
        public readonly skip: boolean = false,
    ) {
        super(message);
        this.name = 'EcgAiError';
    }
}
