import * as path from 'path';
import * as dotenv from 'dotenv';
import {
  HttpEcgAnomalyProvider,
  readEcgAiConfigFromEnv,
} from '../../src/modules/lab-test/ecg-ai-analysis/http-ecg-anomaly.provider';
import {
  ECG_OVERALL_RESULTS,
  EcgAiError,
  EcgAnalyzeInput,
} from '../../src/modules/lab-test/ecg-ai-analysis/ecg-anomaly-provider.port';

/**
 * SMOKE TEST dịch vụ AI ECG THẬT (Python). Không chạy trong unit/CI mặc định, chạy tay bằng:
 *
 *   ECG_AI_BASE_URL=http://localhost:8000 npx jest --config test/jest-smoke.json
 *
 * Biến môi trường (đọc thêm từ .env ở thư mục gốc, không ghi đè biến đã có):
 *   ECG_AI_BASE_URL           URL dịch vụ khi chạy từ máy host. Ưu tiên hơn ECG_AI_BASE_URL, vì .env thường là
 *                              http://ecg-ai:8000 (hostname chỉ phân giải được trong mạng docker-compose).
 *   ECG_AI_API_KEY             nếu dịch vụ bật xác thực (phải trùng giá trị của container ecg-ai)
 *   ECG_AI_SMOKE_MODEL_NAME    tên model gửi trong metadata.model.name   (mặc định: 'default')
 *   ECG_AI_SMOKE_MODEL_VERSION phiên bản gửi trong metadata.model.version (mặc định: '1')
 *   ECG_AI_SMOKE_SAMPLE_RATE   tần số lấy mẫu của tín hiệu giả (mặc định: 500)
 *
 * Không đặt URL -> toàn bộ suite bị skip (không fail).
 *
 * LƯU Ý: tín hiệu ở đây là sóng giả tạo (hình sin + xung), chỉ để kiểm tra HỢP ĐỒNG API (dịch vụ sống, nhận
 * multipart, trả JSON đúng định dạng). Nó KHÔNG đánh giá chất lượng chẩn đoán của model.
 */

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const env = process.env;
const baseUrl = (env.ECG_AI_BASE_URL || env.ECG_AI_BASE_URL || '').trim() || undefined;
const base = readEcgAiConfigFromEnv({ ...env, ECG_AI_BASE_URL: baseUrl } as NodeJS.ProcessEnv);
const SAMPLE_RATE_HZ = Number(env.ECG_AI_SMOKE_SAMPLE_RATE) || 500;
const LEAD_NAMES = ['I', 'II']; // model được finetune trên 2 kênh (ECG_REQUIRED_LEADS=2)

const describeIfConfigured = baseUrl ? describe : describe.skip;

/** CSV: dòng đầu là tên lead, mỗi dòng sau là 1 mẫu (cùng định dạng buildEcgCsv của e2e WF-03). */
function buildSignalCsv(seconds: number): Buffer {
  const rows: string[] = [LEAD_NAMES.join(',')];
  for (let i = 0; i < seconds * SAMPLE_RATE_HZ; i++) {
    const t = i / SAMPLE_RATE_HZ;
    rows.push(
      LEAD_NAMES.map((_, k) => (Math.sin(2 * Math.PI * 1.2 * t + k * 0.1) + (i % 97 === 0 ? 0.5 : 0)).toFixed(4)).join(','),
    );
  }
  return Buffer.from(rows.join('\n') + '\n', 'utf8');
}

const buildInput = (seconds = 10): EcgAnalyzeInput => ({
  recordingId: `smoke-${Date.now()}`,
  signalFormat: 'csv',
  sampleRateHz: SAMPLE_RATE_HZ,
  numLeads: LEAD_NAMES.length,
  leadNames: LEAD_NAMES,
  durationMs: seconds * 1000,
  model: { name: env.ECG_AI_SMOKE_MODEL_NAME || 'default', version: env.ECG_AI_SMOKE_MODEL_VERSION || '1' },
  options: {},
  signal: buildSignalCsv(seconds),
  fileName: 'smoke.csv',
});

describeIfConfigured(`ECG AI service thật (${baseUrl})`, () => {
  const provider = new HttpEcgAnomalyProvider({ ...base, baseUrl });

  it('GET /health -> 200 (tiến trình dịch vụ đang sống)', async () => {
    const res = await fetch(`${baseUrl!.replace(/\/+$/, '')}/health`);
    expect(res.status).toBe(200);
  });

  it('POST /v1/ecg/analyze với tín hiệu CSV 2 lead -> trả kết quả đúng hợp đồng (EcgAnalyzeResult)', async () => {
    const result = await provider.analyze(buildInput());

    // provider đã validate chặt bằng parseAnalyzeResult; ở đây khẳng định thêm các bất biến chính
    expect(ECG_OVERALL_RESULTS).toContain(result.overallResult);
    expect(Array.isArray(result.anomalies)).toBe(true);
    for (const a of result.anomalies) {
      expect(a.score).toBeGreaterThanOrEqual(0);
      expect(a.score).toBeLessThanOrEqual(1);
      expect(a.endOffsetMs).toBeGreaterThanOrEqual(a.startOffsetMs);
    }
    if (result.maxAnomalyScore !== null) {
      expect(result.maxAnomalyScore).toBeGreaterThanOrEqual(0);
      expect(result.maxAnomalyScore).toBeLessThanOrEqual(1);
    }
    // nếu có anomaly thì điểm lớn nhất phải khớp maxAnomalyScore (cho phép sai số làm tròn)
    if (result.anomalies.length > 0 && result.maxAnomalyScore !== null) {
      const top = Math.max(...result.anomalies.map((a) => a.score));
      expect(top).toBeLessThanOrEqual(result.maxAnomalyScore + 1e-6);
    }
  });

  it('tệp không phải tín hiệu hợp lệ -> dịch vụ từ chối bằng lỗi có kiểm soát (EcgAiError, không treo/crash)', async () => {
    const bad: EcgAnalyzeInput = { ...buildInput(), signal: Buffer.from('đây không phải csv ECG'), fileName: 'bad.csv' };
    let caught: unknown;
    try {
      await provider.analyze(bad);
    } catch (err) {
      caught = err;
    }
    // Dịch vụ có thể trả 4xx (AI_HTTP_4xx) hoặc 200 với overallResult 'inconclusive'/'poor_signal'.
    // Điều không được phép: ném lỗi KHÔNG phải EcgAiError, hoặc 5xx do crash.
    if (caught !== undefined) {
      expect(caught).toBeInstanceOf(EcgAiError);
      expect((caught as EcgAiError).code).not.toMatch(/^AI_HTTP_5/);
    }
  });

  const itIfApiKey = base.apiKey ? it : it.skip;
  itIfApiKey('sai API key -> bị từ chối (AI_HTTP_401 hoặc AI_HTTP_403)', async () => {
    const wrong = new HttpEcgAnomalyProvider({ ...base, baseUrl, apiKey: `${base.apiKey}-sai` });
    await expect(wrong.analyze(buildInput(2))).rejects.toMatchObject({ code: expect.stringMatching(/^AI_HTTP_40[13]$/) });
  });
});
