/**
 * Sinh bộ ECG TỔNG HỢP (chỉ để kiểm thử harness — KHÔNG có giá trị lâm sàng): 1 chuyển đạo II, 250Hz, 20s.
 * Lớp: normal (nhịp xoang) · afib (RR bất thường) · tachy · brady · noise (không dùng được).
 * Ghi tools/ecg-benchmark/fixtures/*.csv + manifest.jsonl.   Chạy: npx tsx tools/ecg-benchmark/generate-fixtures.ts
 */
import fs from 'fs';
import path from 'path';

const FS = 250, SECONDS = 20, DIR = path.join(__dirname, 'fixtures');
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
const g = (t: number, mu: number, sigma: number, a: number) => a * Math.exp(-((t - mu) ** 2) / (2 * sigma ** 2));

function synth(kind: string): { x: number[]; label: string } {
    const n = FS * SECONDS, x = new Array(n).fill(0);
    if (kind === 'noise') { for (let i = 0; i < n; i++) x[i] = 0.04 * gauss(); return { x, label: 'unusable' }; }
    const hr = kind === 'tachy' ? 130 + rnd() * 25 : kind === 'brady' ? 36 + rnd() * 10 : kind === 'afib' ? 90 + rnd() * 40 : 60 + rnd() * 25;
    const meanRR = 60 / hr;
    const jitter = kind === 'afib' ? 0.28 : 0.03;
    let t = 0.5;
    const beats: number[] = [];
    while (t < SECONDS - 0.5) { beats.push(t); t += Math.max(0.3, meanRR * (1 + jitter * gauss())); }
    for (let i = 0; i < n; i++) {
        const ti = i / FS; let v = 0;
        for (const b of beats) {
            const d = ti - b; if (Math.abs(d) > 0.6) continue;
            v += g(d, 0, 0.012, 1.0) + g(d, -0.02, 0.01, -0.12) + g(d, 0.025, 0.01, -0.18) + g(d, 0.26, 0.045, 0.28);
            if (kind !== 'afib') v += g(d, -0.18, 0.025, 0.1);
        }
        x[i] = v + 0.015 * gauss() + 0.04 * Math.sin(2 * Math.PI * 0.3 * ti);
    }
    return { x, label: kind === 'normal' ? 'normal' : 'abnormal' };
}

fs.mkdirSync(DIR, { recursive: true });
const plan: [string, number][] = [['normal', 16], ['afib', 8], ['tachy', 4], ['brady', 4], ['noise', 3]];
const lines: string[] = [];
for (const [kind, count] of plan) for (let i = 1; i <= count; i++) {
    const { x, label } = synth(kind);
    const file = `${kind}_${String(i).padStart(2, '0')}.csv`;
    fs.writeFileSync(path.join(DIR, file), 'II\n' + x.map((v) => v.toFixed(4)).join('\n') + '\n');
    lines.push(JSON.stringify({ id: file.replace('.csv', ''), file, format: 'csv', sampleRateHz: FS, numLeads: 1, leadNames: ['II'], label, subtype: kind }));
}
fs.writeFileSync(path.join(DIR, 'manifest.jsonl'), lines.join('\n') + '\n');
console.log(`Đã sinh ${lines.length} bản ghi tại ${DIR}`);
