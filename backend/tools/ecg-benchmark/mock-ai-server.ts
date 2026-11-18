/**
 * SERVER AI MẪU — hiện thực HỢP ĐỒNG POST /v1/ecg/analyze (xem ecg-anomaly-provider.port.ts) để:
 *   (1) chạy được toàn bộ luồng + benchmark khi dịch vụ Python thật chưa sẵn sàng;
 *   (2) làm tài liệu sống cho đội AI: input/output chính xác là gì.
 * Thuật toán chỉ là heuristic nhịp tim/RR (KHÔNG phải model lâm sàng) và chỉ đọc CSV (header = tên chuyển đạo).
 *
 * Chạy:  npx tsx tools/ecg-benchmark/mock-ai-server.ts [port=8099]
 */
import http from 'http';

interface Meta { recordingId: string; signalFormat: string; sampleRateHz: number; numLeads: number; leadNames: string[]; options: { threshold?: number } }
interface AnalyzeResult {
    overallResult?: 'poor_signal' | 'abnormal' | 'normal';
    maxAnomalyScore: number | null;
    thresholdUsed: number;
    windowMs: number | null;
    strideMs: number | null;
    signalQuality?: number;
    summaryMetrics: {
        hrMean: number;
        rrCv: number;
        beats: number;
    } | null;
    inferenceLatencyMs: number | null;
    anomalies: unknown[];
}

function parseCsv(text: string): { names: string[]; cols: number[][] } {
    const lines = text.trim().split(/\r?\n/);
    const names = lines[0].split(',').map((s) => s.trim());
    const cols: number[][] = names.map(() => []);
    for (const line of lines.slice(1)) line.split(',').forEach((v, i) => cols[i]?.push(Number(v)));
    return { names, cols };
}

export function analyzeCsv(
    text: string,
    fs: number,
    threshold = 0.5,
): AnalyzeResult {
    const { names, cols } = parseCsv(text);
    const x = cols[Math.max(0, names.findIndex((n) => /^(ii|lead ?ii)$/i.test(n)))] ?? cols[0];
    const durationMs = Math.round((x.length / fs) * 1000);
    const max = Math.max(...x), min = Math.min(...x);
    const empty = { maxAnomalyScore: null, thresholdUsed: threshold, windowMs: null, strideMs: null, summaryMetrics: null, inferenceLatencyMs: null, anomalies: [] as unknown[] };

    // R-peak: vượt 60% biên độ, không ứng viên nào trong 250ms.
    const cut = min + 0.6 * (max - min);
    const peaks: number[] = [];
    for (let i = 1; i < x.length - 1; i++) {
        if (x[i] > cut && x[i] >= x[i - 1] && x[i] >= x[i + 1] && (peaks.length === 0 || i - peaks[peaks.length - 1] > 0.25 * fs)) peaks.push(i);
    }
    if (max - min < 0.5 || peaks.length < 4) {
        return { ...empty, overallResult: 'poor_signal', signalQuality: 0.1 };
    }

    const rr = peaks.slice(1).map((p, i) => ((p - peaks[i]) / fs) * 1000);
    const mean = rr.reduce((a, b) => a + b, 0) / rr.length;
    const sd = Math.sqrt(rr.reduce((a, b) => a + (b - mean) ** 2, 0) / rr.length);
    const cv = sd / mean, hr = 60000 / mean;
    const anomalies: any[] = [];
    const base = { affectedLeads: [names[0]], heartRateBpm: Math.round(hr) };

    if (cv > 0.15) {
        rr.forEach((v, i) => {
            if (Math.abs(v - mean) > 0.2 * mean && anomalies.length < 20) {
                anomalies.push({ ...base, anomalyType: 'irregular_rhythm', score: Math.min(1, cv / 0.3), severity: 'high', startOffsetMs: Math.round((peaks[i] / fs) * 1000), endOffsetMs: Math.round((peaks[i + 1] / fs) * 1000), details: { rrMs: Math.round(v) } });
            }
        });
    }
    if (hr > 120) anomalies.push({ ...base, anomalyType: 'tachycardia', score: Math.min(1, (hr - 100) / 60), severity: hr > 150 ? 'high' : 'medium', startOffsetMs: 0, endOffsetMs: durationMs, details: null });
    if (hr < 50) anomalies.push({ ...base, anomalyType: 'bradycardia', score: Math.min(1, (50 - hr) / 20 + 0.3), severity: hr < 40 ? 'high' : 'medium', startOffsetMs: 0, endOffsetMs: durationMs, details: null });

    const kept = anomalies.filter((a) => a.score >= threshold);
    return {
        overallResult: kept.length ? 'abnormal' : 'normal',
        maxAnomalyScore: anomalies.length ? Math.max(...anomalies.map((a) => a.score)) : Math.min(1, cv / 0.3),
        thresholdUsed: threshold, windowMs: null, strideMs: null, signalQuality: 0.9,
        summaryMetrics: { hrMean: Math.round(hr), rrCv: Number(cv.toFixed(3)), beats: peaks.length },
        inferenceLatencyMs: null, anomalies: kept,
    };
}

export function startMockServer(port: number, opts: { delayMs?: number; failWith?: number } = {}): Promise<http.Server> {
    const server = http.createServer(async (req, res) => {
        if (req.method !== 'POST' || req.url !== '/v1/ecg/analyze') { res.writeHead(404).end(); return; }
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        if (opts.failWith) { res.writeHead(opts.failWith).end('boom'); return; }
        if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
        try {
            const form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': String(req.headers['content-type']) } }).formData();
            const meta: Meta = JSON.parse(String(form.get('metadata')));
            const file = form.get('signal') as File | null;
            if (!file) { res.writeHead(422).end('signal missing'); return; }
            if (meta.signalFormat !== 'csv') { res.writeHead(415).end('mock chỉ hỗ trợ csv'); return; }
            const t0 = Date.now();
            const out = analyzeCsv(
                await file.text(),
                meta.sampleRateHz,
                meta.options?.threshold ?? 0.5,
            );
            out.inferenceLatencyMs = Date.now() - t0;
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
        } catch (e) { res.writeHead(400).end(String(e)); }
    });
    return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (require.main === module) {
    const port = Number(process.argv[2] ?? 8099);
    startMockServer(port).then(() => console.log(`Mock ECG AI server: http://localhost:${port}/v1/ecg/analyze`));
}
