/**
 * Chuẩn hoá response ECG cho FE (module lab/ecg):
 *  - Decimal (Prisma) -> number (JSON mặc định ra chuỗi "0.83000").
 *  - Bổ sung trường FE đang đọc: `score`, `anomalies`, `scoreSeries`, `reviewedByName`, `latestAnalysis`,
 *    `patientName`, `encounterCode`, `originalFileName`...
 *  - GIỮ NGUYÊN mọi trường Prisma gốc (chỉ thêm, không đổi tên) để client cũ không vỡ.
 */

/** Điểm theo cửa sổ trượt (tuỳ chọn, do dịch vụ AI trả về) — lưu trong summaryMetrics.scoreSeries. */
export interface EcgScorePoint {
    tMs: number;
    score: number;
}

export const SCORE_SERIES_KEY = 'scoreSeries';

export const toNumber = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

interface UserNameSource {
    email?: string | null;
    profile?: { fullName?: string | null } | null;
}

export const userDisplayName = (u: UserNameSource | null | undefined): string | null => u?.profile?.fullName ?? u?.email ?? null;

/** Tách scoreSeries ra khỏi summaryMetrics để summaryMetrics chỉ còn số liệu tóm tắt. */
export function splitSummaryMetrics(raw: unknown): { summaryMetrics: Record<string, unknown> | null; scoreSeries: EcgScorePoint[] | null } {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { summaryMetrics: null, scoreSeries: null };
    const { [SCORE_SERIES_KEY]: series, ...rest } = raw as Record<string, unknown>;
    const scoreSeries = Array.isArray(series)
        ? series.flatMap((p): EcgScorePoint[] => {
              const o = p as { tMs?: unknown; score?: unknown };
              const tMs = toNumber(o?.tMs);
              const score = toNumber(o?.score);
              return tMs !== null && score !== null ? [{ tMs, score }] : [];
          })
        : null;
    return { summaryMetrics: Object.keys(rest).length ? rest : null, scoreSeries: scoreSeries?.length ? scoreSeries : null };
}

type AnyRecord = Record<string, any>;

export function toEventResponse<T extends AnyRecord>(event: T) {
    const { reviewedByUser, acknowledgedByUser, ...rest } = event;
    return {
        ...rest,
        // `eventId` giữ nguyên; thêm `id` + `score` để FE không phải đoán tên.
        id: event.eventId,
        anomalyScore: toNumber(event.anomalyScore),
        score: toNumber(event.anomalyScore),
        reviewedByName: userDisplayName(reviewedByUser),
        acknowledgedByName: userDisplayName(acknowledgedByUser),
    };
}

export function toAnalysisResponse<T extends AnyRecord>(analysis: T) {
    const { summaryMetrics: rawMetrics, events, modelVersion, ...rest } = analysis;
    const { summaryMetrics, scoreSeries } = splitSummaryMetrics(rawMetrics);
    const mappedEvents = Array.isArray(events) ? events.map(toEventResponse) : undefined;
    return {
        ...rest,
        id: analysis.analysisId,
        modelVersion,
        modelName: modelVersion?.modelName ?? null,
        modelVersionLabel: modelVersion?.version ?? null,
        maxAnomalyScore: toNumber(analysis.maxAnomalyScore),
        thresholdUsed: toNumber(analysis.thresholdUsed),
        summaryMetrics,
        scoreSeries,
        ...(mappedEvents ? { events: mappedEvents, anomalies: mappedEvents } : {}),
    };
}

export function toRecordingResponse<T extends AnyRecord>(recording: T) {
    const { encounter, analyses, acquisitionMeta, ...rest } = recording;
    const mapped = Array.isArray(analyses) ? analyses.map(toAnalysisResponse) : undefined;
    const meta = typeof acquisitionMeta === 'object' && acquisitionMeta !== null ? (acquisitionMeta as AnyRecord) : null;
    return {
        ...rest,
        id: recording.ecgRecordingId,
        acquisitionMeta: acquisitionMeta ?? null,
        originalFileName: typeof meta?.originalFileName === 'string' ? meta.originalFileName : null,
        signalQuality: toNumber(recording.signalQuality),
        patientName: encounter?.patient?.fullName ?? null,
        encounterCode: encounter?.encounterCode ?? null,
        ...(mapped
            ? {
                  analyses: mapped,
                  // Bản mới nhất (kể cả queued/running/failed) -> UI hiển thị tiến trình phân tích.
                  latestAnalysis: mapped[0] ?? null,
                  // Bản đang hiển thị kết quả (isCurrent) -> UI vẫn có dữ liệu khi đang chạy lại.
                  currentAnalysis: mapped.find((a) => a.isCurrent) ?? null,
              }
            : {}),
    };
}
