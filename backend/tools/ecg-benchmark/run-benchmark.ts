/**
 * BENCHMARK dịch vụ AI ECG qua ĐÚNG adapter production (HttpEcgAnomalyProvider) — đo cả hợp đồng HTTP, kiểm tra
 * phản hồi và độ trễ, không chỉ độ chính xác model.
 *
 * Dùng:
 *   npx tsx tools/ecg-benchmark/run-benchmark.ts --manifest <manifest.jsonl> --base-url http://localhost:8000 \
 *        [--out tools/ecg-benchmark/out] [--timeout 60000] [--api-key KEY] [--threshold 0.5] [--concurrency 2]
 *
 * manifest.jsonl — mỗi dòng 1 JSON (đường dẫn `file` tính từ thư mục chứa manifest):
 *   { "id":"rec1", "file":"rec1.csv", "format":"csv|json|edf|wfdb|dicom_ecg|scp_ecg", "sampleRateHz":500, "numLeads":12,
 *     "leadNames":["I",...], "label":"normal|abnormal|unusable", "subtype":"afib" }
 *   (wfdb: nén .hea+.dat thành .zip). `label` là nhãn chuẩn của bộ benchmark (vd: PTB-XL/MIT-BIH đã quy về normal/abnormal).
 *
 * Quy ước: dự đoán DƯƠNG = overallResult 'abnormal'. 'inconclusive' / 'poor_signal' / lỗi = KHÔNG QUYẾT ĐỊNH, được báo
 * riêng và tính vào sensitivity "xấu nhất" (bản ghi abnormal mà AI không quyết định được coi là bị bỏ sót).
 */
import fs from 'fs';
import path from 'path';
import { HttpEcgAnomalyProvider } from '../../src/modules/lab-test/ecg-ai-analysis/http-ecg-anomaly.provider';
import { EcgAiError, EcgAnalyzeResult } from '../../src/modules/lab-test/ecg-ai-analysis/ecg-anomaly-provider.port';

interface Row { id: string; file: string; format: string; sampleRateHz: number; numLeads: number; leadNames?: string[]; label: 'normal' | 'abnormal' | 'unusable'; subtype?: string }
interface Outcome { row: Row; result?: EcgAnalyzeResult; errorCode?: string; latencyMs: number }

export function parseArgs(argv: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[i + 1] ?? 'true';
    return out;
}

const pct = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null);
const ratio = (a: number, b: number) => (b === 0 ? null : a / b);
const fmt = (v: number | null, d = 3) => (v === null ? 'n/a' : v.toFixed(d));

/** AUROC bằng xếp hạng (Mann–Whitney); điểm null = 0. Chỉ trên bản ghi có nhãn normal/abnormal. */
export function auroc(scores: { score: number; positive: boolean }[]): number | null {
    const pos = scores.filter((s) => s.positive), neg = scores.filter((s) => !s.positive);
    if (!pos.length || !neg.length) return null;
    let wins = 0;
    for (const p of pos) for (const n of neg) wins += p.score > n.score ? 1 : p.score === n.score ? 0.5 : 0;
    return wins / (pos.length * neg.length);
}

export function computeMetrics(outcomes: Outcome[]) {
    const labelled = outcomes.filter((o) => o.row.label !== 'unusable');
    const decided = labelled.filter((o) => o.result && (o.result.overallResult === 'normal' || o.result.overallResult === 'abnormal'));
    const pred = (o: Outcome) => o.result!.overallResult === 'abnormal';
    const tp = decided.filter((o) => o.row.label === 'abnormal' && pred(o)).length;
    const fn = decided.filter((o) => o.row.label === 'abnormal' && !pred(o)).length;
    const tn = decided.filter((o) => o.row.label === 'normal' && !pred(o)).length;
    const fp = decided.filter((o) => o.row.label === 'normal' && pred(o)).length;
    const posTotal = labelled.filter((o) => o.row.label === 'abnormal').length;
    const negTotal = labelled.filter((o) => o.row.label === 'normal').length;
    const precision = ratio(tp, tp + fp), sensitivity = ratio(tp, tp + fn);

    const bySub: Record<string, { n: number; detected: number }> = {};
    for (const o of labelled.filter((x) => x.row.label === 'abnormal')) {
        const k = o.row.subtype ?? 'abnormal';
        bySub[k] ??= { n: 0, detected: 0 };
        bySub[k].n++;
        if (o.result?.overallResult === 'abnormal') bySub[k].detected++;
    }

    const unusable = outcomes.filter((o) => o.row.label === 'unusable');
    const lat = outcomes.map((o) => o.latencyMs).sort((a, b) => a - b);
    const failures: Record<string, number> = {};
    for (const o of outcomes) if (o.errorCode) failures[o.errorCode] = (failures[o.errorCode] ?? 0) + 1;
    const dist: Record<string, number> = {};
    for (const o of outcomes) if (o.result) dist[o.result.overallResult] = (dist[o.result.overallResult] ?? 0) + 1;

    return {
        total: outcomes.length,
        labelled: labelled.length,
        confusion: { tp, fn, tn, fp },
        coverage: ratio(decided.length, labelled.length),
        sensitivityDecided: sensitivity,
        sensitivityWorstCase: ratio(tp, posTotal),
        specificityDecided: ratio(tn, tn + fp),
        specificityWorstCase: ratio(tn, negTotal),
        precision,
        accuracyDecided: ratio(tp + tn, decided.length),
        f1: precision !== null && sensitivity !== null && precision + sensitivity > 0 ? (2 * precision * sensitivity) / (precision + sensitivity) : null,
        auroc: auroc(labelled.filter((o) => o.row.label !== 'unusable').map((o) => ({ score: o.result?.maxAnomalyScore ?? 0, positive: o.row.label === 'abnormal' }))),
        recallBySubtype: Object.fromEntries(Object.entries(bySub).map(([k, v]) => [k, { n: v.n, detected: v.detected, recall: ratio(v.detected, v.n) }])),
        unusable: { n: unusable.length, flaggedNonDecision: unusable.filter((o) => o.result && ['poor_signal', 'inconclusive'].includes(o.result.overallResult)).length, wronglyDecided: unusable.filter((o) => o.result && ['normal', 'abnormal'].includes(o.result.overallResult)).length },
        resultDistribution: dist,
        failures,
        failureRate: ratio(Object.values(failures).reduce((a, b) => a + b, 0), outcomes.length),
        latencyMs: { p50: pct(lat, 50), p95: pct(lat, 95), max: lat.length ? lat[lat.length - 1] : null },
    };
}

export function renderReport(m: ReturnType<typeof computeMetrics>, meta: { manifest: string; baseUrl: string; threshold?: number; durationMs: number }): string {
    const c = m.confusion;
    const rows = Object.entries(m.recallBySubtype).map(([k, v]) => `| ${k} | ${v.n} | ${v.detected} | ${fmt(v.recall)} |`).join('\n');
    return `# Báo cáo benchmark ECG AI

- Manifest: \`${meta.manifest}\` · Dịch vụ: \`${meta.baseUrl}\` · Ngưỡng: ${meta.threshold ?? 'mặc định model'} · Thời gian chạy: ${(meta.durationMs / 1000).toFixed(1)}s
- Tổng bản ghi: **${m.total}** (có nhãn normal/abnormal: ${m.labelled}) · Tỷ lệ lỗi dịch vụ: **${fmt(m.failureRate)}**

## Độ chính xác (dương = \`abnormal\`)
| Chỉ số | Chỉ ca AI quyết định được | Xấu nhất (ca không quyết định = sai) |
|---|---|---|
| Sensitivity (recall) | **${fmt(m.sensitivityDecided)}** | ${fmt(m.sensitivityWorstCase)} |
| Specificity | **${fmt(m.specificityDecided)}** | ${fmt(m.specificityWorstCase)} |

Precision ${fmt(m.precision)} · F1 ${fmt(m.f1)} · Accuracy ${fmt(m.accuracyDecided)} · **AUROC ${fmt(m.auroc)}** · Coverage (ca quyết định được) ${fmt(m.coverage)}

| | Dự đoán abnormal | Dự đoán normal |
|---|---|---|
| **Thật abnormal** | TP = ${c.tp} | FN = ${c.fn} |
| **Thật normal** | FP = ${c.fp} | TN = ${c.tn} |

## Recall theo nhóm bất thường
| Nhóm | Số ca | AI báo abnormal | Recall |
|---|---|---|---|
${rows || '| (không có) | | | |'}

## Tín hiệu không dùng được (label = unusable): ${m.unusable.n} ca
- Được gắn poor_signal/inconclusive (đúng kỳ vọng): ${m.unusable.flaggedNonDecision}
- Bị kết luận normal/abnormal (nguy hiểm — kết luận trên tín hiệu rác): ${m.unusable.wronglyDecided}

## Vận hành
- Phân bố overallResult: ${JSON.stringify(m.resultDistribution)}
- Lỗi theo errorCode: ${JSON.stringify(m.failures)}
- Độ trễ: p50 ${m.latencyMs.p50}ms · p95 ${m.latencyMs.p95}ms · max ${m.latencyMs.max}ms
`;
}

export async function runBenchmark(opts: { manifest: string; baseUrl: string; timeoutMs: number; apiKey?: string; threshold?: number; concurrency: number }) {
    const dir = path.dirname(opts.manifest);
    const rows: Row[] = fs.readFileSync(opts.manifest, 'utf-8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
    const provider = new HttpEcgAnomalyProvider({ baseUrl: opts.baseUrl, timeoutMs: opts.timeoutMs, apiKey: opts.apiKey });
    const outcomes: Outcome[] = new Array(rows.length);
    let next = 0;

    const worker = async () => {
        while (next < rows.length) {
            const i = next++;
            const row = rows[i];
            const started = Date.now();
            try {
                const result = await provider.analyze({
                    recordingId: row.id, signal: fs.readFileSync(path.join(dir, row.file)), fileName: path.basename(row.file), signalFormat: row.format,
                    sampleRateHz: row.sampleRateHz, numLeads: row.numLeads, leadNames: row.leadNames ?? [], durationMs: null,
                    model: { name: 'benchmark', version: 'n/a' }, options: opts.threshold !== undefined ? { threshold: opts.threshold } : {},
                });
                outcomes[i] = { row, result, latencyMs: Date.now() - started };
            } catch (err) {
                outcomes[i] = { row, errorCode: err instanceof EcgAiError ? err.code : 'UNEXPECTED', latencyMs: Date.now() - started };
            }
        }
    };
    const t0 = Date.now();
    await Promise.all(Array.from({ length: Math.max(1, opts.concurrency) }, worker));
    const metrics = computeMetrics(outcomes);
    return { metrics, outcomes, durationMs: Date.now() - t0 };
}

if (require.main === module) {
    const a = parseArgs(process.argv.slice(2));
    if (!a.manifest || !a['base-url']) { console.error('Thiếu --manifest hoặc --base-url (xem phần chú thích đầu file)'); process.exit(2); }
    const outDir = a.out ?? path.join(__dirname, 'out');
    const threshold = a.threshold !== undefined ? Number(a.threshold) : undefined;
    runBenchmark({ manifest: path.resolve(a.manifest), baseUrl: a['base-url'], timeoutMs: Number(a.timeout ?? 60000), apiKey: a['api-key'], threshold, concurrency: Number(a.concurrency ?? 2) }).then(({ metrics, outcomes, durationMs }) => {
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ metrics, perRecord: outcomes.map((o) => ({ id: o.row.id, label: o.row.label, subtype: o.row.subtype, overallResult: o.result?.overallResult ?? null, maxAnomalyScore: o.result?.maxAnomalyScore ?? null, anomalyCount: o.result?.anomalies.length ?? null, errorCode: o.errorCode ?? null, latencyMs: o.latencyMs })) }, null, 2));
        fs.writeFileSync(path.join(outDir, 'report.md'), renderReport(metrics, { manifest: a.manifest, baseUrl: a['base-url'], threshold, durationMs }));
        console.log(renderReport(metrics, { manifest: a.manifest, baseUrl: a['base-url'], threshold, durationMs }));
        console.log(`Đã ghi ${path.join(outDir, 'results.json')} và report.md`);
    });
}
