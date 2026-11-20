/**
 * Gán nhãn anomaly cho TỪNG MẪU tín hiệu từ các đoạn bất thường AI đã phát hiện (EcgAnomalyEvent).
 * Mẫu thứ i có thời điểm t = i * 1000 / sampleRateHz (ms từ đầu bản ghi) -> 1 nếu nằm trong [startOffsetMs, endOffsetMs]
 * (gồm cả hai đầu) của ít nhất một đoạn, ngược lại 0. Độ phức tạp O(số đoạn + số mẫu).
 */
export interface AnomalyInterval {
    startOffsetMs: number;
    endOffsetMs: number;
}

export function buildAnomalyFlags(totalSamples: number, sampleRateHz: number, intervals: readonly AnomalyInterval[]): Uint8Array {
    const flags = new Uint8Array(totalSamples);
    if (totalSamples === 0 || !(sampleRateHz > 0)) return flags;
    const msPerSample = 1000 / sampleRateHz;
    for (const { startOffsetMs, endOffsetMs } of intervals) {
        if (!Number.isFinite(startOffsetMs) || !Number.isFinite(endOffsetMs)) continue;
        const lo = Math.max(0, Math.min(startOffsetMs, endOffsetMs));
        const hi = Math.max(startOffsetMs, endOffsetMs);
        const first = Math.ceil(lo / msPerSample - 1e-9);
        const last = Math.min(totalSamples - 1, Math.floor(hi / msPerSample + 1e-9));
        for (let i = first; i <= last; i++) flags[i] = 1;
    }
    return flags;
}

/** Thời điểm (ms, làm tròn 3 chữ số thập phân) của mẫu thứ i. */
export const sampleTimeMs = (index: number, sampleRateHz: number): number => Math.round((index * 1_000_000) / sampleRateHz) / 1000;
