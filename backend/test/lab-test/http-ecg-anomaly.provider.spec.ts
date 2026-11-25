import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import {
  HttpEcgAnomalyProvider,
  readEcgAiConfigFromEnv,
} from '../../src/modules/lab-test/ecg-ai-analysis/http-ecg-anomaly.provider';
import { EcgAiError, EcgAnalyzeInput } from '../../src/modules/lab-test/ecg-ai-analysis/ecg-anomaly-provider.port';

/**
 * Test ADAPTER HTTP (HttpEcgAnomalyProvider) với server HTTP giả chạy trên 127.0.0.1 (cổng ngẫu nhiên).
 * Provider là code THẬT, gọi `fetch` thật qua mạng loopback; chỉ phía "dịch vụ AI Python" là giả.
 * => kiểm tra: URL/method, multipart (metadata + signal), header Authorization, parse response,
 *    và mã lỗi ổn định AI_NOT_CONFIGURED / AI_TIMEOUT / AI_UNAVAILABLE / AI_HTTP_<status> / AI_INVALID_RESPONSE.
 * KHÔNG kiểm tra chất lượng model (xem test/smoke/ecg-ai.smoke-spec.ts để gọi dịch vụ thật).
 */

const VALID_RESULT = {
  overallResult: 'abnormal',
  maxAnomalyScore: 0.93,
  thresholdUsed: 0.5,
  windowMs: 2000,
  strideMs: 1000,
  signalQuality: 0.97,
  summaryMetrics: { hrMean: 112 },
  inferenceLatencyMs: 42,
  anomalies: [
    {
      anomalyType: 'afib',
      score: 0.93,
      severity: 'high',
      startOffsetMs: 1000,
      endOffsetMs: 2800,
      affectedLeads: ['II'],
      heartRateBpm: 131,
      details: null,
    },
  ],
  scoreSeries: [
    { tMs: 0, score: 0.1 },
    { tMs: 1000, score: 0.93 },
  ],
};

const buildInput = (): EcgAnalyzeInput => ({
  recordingId: 'rec-123',
  signalFormat: 'csv',
  sampleRateHz: 500,
  numLeads: 2,
  leadNames: ['I', 'II'],
  durationMs: 1000,
  model: { name: 'tsad-ptbxl', version: '1.0.0' },
  options: { threshold: 0.5 },
  signal: Buffer.from('I,II\n0.1,0.2\n0.3,0.4\n', 'utf8'),
  fileName: 'ecg.csv',
});

interface CapturedRequest {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

async function expectAiError(promise: Promise<unknown>, code: string, skip = false): Promise<EcgAiError> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(EcgAiError);
  expect(caught).toMatchObject({ code, skip });
  return caught as EcgAiError;
}

describe('HttpEcgAnomalyProvider (adapter HTTP, server giả)', () => {
  let server: Server;
  let baseUrl: string;
  let lastRequest: CapturedRequest | undefined;
  let handler: (req: IncomingMessage, res: ServerResponse, captured: CapturedRequest) => void;
  const pendingTimers = new Set<NodeJS.Timeout>();

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c as Buffer));
      req.on('end', () => {
        lastRequest = { method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) };
        handler(req, res, lastRequest);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections?.();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    lastRequest = undefined;
    handler = (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(VALID_RESULT));
    };
  });

  afterEach(() => {
    pendingTimers.forEach(clearTimeout);
    pendingTimers.clear();
    server.closeAllConnections?.();
  });

  const makeProvider = (over: Partial<{ baseUrl: string; timeoutMs: number; apiKey: string }> = {}) =>
    new HttpEcgAnomalyProvider({ baseUrl, timeoutMs: 5000, ...over });

  // -------------------------------------------------------------------------------- cấu hình

  describe('isConfigured / AI_NOT_CONFIGURED', () => {
    it('isConfigured() = true khi có baseUrl, false khi không', () => {
      expect(makeProvider().isConfigured()).toBe(true);
      expect(new HttpEcgAnomalyProvider({ timeoutMs: 1000 }).isConfigured()).toBe(false);
    });

    it('chưa cấu hình baseUrl -> EcgAiError AI_NOT_CONFIGURED (skip=true) và KHÔNG gọi mạng', async () => {
      const provider = new HttpEcgAnomalyProvider({ timeoutMs: 1000 });
      await expectAiError(provider.analyze(buildInput()), 'AI_NOT_CONFIGURED', true);
      expect(lastRequest).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------------- request gửi đi

  describe('request gửi tới dịch vụ AI', () => {
    it('POST /v1/ecg/analyze, multipart có field `metadata` (JSON) và `signal` (đúng tên + nội dung tệp)', async () => {
      const input = buildInput();
      await makeProvider().analyze(input);

      expect(lastRequest?.method).toBe('POST');
      expect(lastRequest?.url).toBe('/v1/ecg/analyze');
      expect(lastRequest?.headers['content-type']).toMatch(/^multipart\/form-data; boundary=/);

      // Ép kiểu vì @types/node mới: Buffer<ArrayBufferLike> không khớp BodyInit của lib DOM (runtime vẫn đúng).
      const form = await new Response(lastRequest!.body as unknown as BodyInit, {
        headers: { 'content-type': String(lastRequest!.headers['content-type']) },
      }).formData();

      const metadata = JSON.parse(String(form.get('metadata')));
      expect(metadata).toEqual({
        recordingId: 'rec-123',
        signalFormat: 'csv',
        sampleRateHz: 500,
        numLeads: 2,
        leadNames: ['I', 'II'],
        durationMs: 1000,
        model: { name: 'tsad-ptbxl', version: '1.0.0' },
        options: { threshold: 0.5 },
      });
      // metadata không được chứa dữ liệu tín hiệu thô / tên tệp
      expect(metadata).not.toHaveProperty('signal');
      expect(metadata).not.toHaveProperty('fileName');

      const signal = form.get('signal') as File;
      expect(signal.name).toBe('ecg.csv');
      expect(await signal.text()).toBe(input.signal.toString('utf8'));
    });

    it('có apiKey -> gửi header Authorization: Bearer <apiKey>', async () => {
      await makeProvider({ apiKey: 'secret-key' }).analyze(buildInput());
      expect(lastRequest?.headers.authorization).toBe('Bearer secret-key');
    });

    it('không có apiKey -> KHÔNG gửi header Authorization', async () => {
      await makeProvider().analyze(buildInput());
      expect(lastRequest?.headers.authorization).toBeUndefined();
    });

    it('baseUrl có dấu "/" ở cuối vẫn gọi đúng /v1/ecg/analyze (không bị //v1/...)', async () => {
      await makeProvider({ baseUrl: `${baseUrl}///` }).analyze(buildInput());
      expect(lastRequest?.url).toBe('/v1/ecg/analyze');
    });
  });

  // -------------------------------------------------------------------------------- response thành công

  describe('response 200', () => {
    it('parse JSON hợp lệ thành EcgAnalyzeResult đầy đủ', async () => {
      const result = await makeProvider().analyze(buildInput());

      expect(result).toMatchObject({
        overallResult: 'abnormal',
        maxAnomalyScore: 0.93,
        thresholdUsed: 0.5,
        windowMs: 2000,
        strideMs: 1000,
        signalQuality: 0.97,
        inferenceLatencyMs: 42,
      });
      expect(result.anomalies).toEqual([
        {
          anomalyType: 'afib',
          score: 0.93,
          severity: 'high',
          startOffsetMs: 1000,
          endOffsetMs: 2800,
          affectedLeads: ['II'],
          heartRateBpm: 131,
          details: null,
        },
      ]);
      expect(result.scoreSeries).toEqual([
        { tMs: 0, score: 0.1 },
        { tMs: 1000, score: 0.93 },
      ]);
    });

    it('kết quả normal không có anomaly: anomalies = [] và các trường tuỳ chọn = null', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ overallResult: 'normal' }));
      };
      const result = await makeProvider().analyze(buildInput());
      expect(result.overallResult).toBe('normal');
      expect(result.anomalies).toEqual([]);
      expect(result.maxAnomalyScore).toBeNull();
      expect(result.scoreSeries).toBeNull();
    });
  });

  // -------------------------------------------------------------------------------- lỗi

  describe('lỗi -> EcgAiError với code ổn định', () => {
    it('HTTP 500 -> AI_HTTP_500, message chứa body lỗi', async () => {
      handler = (_req, res) => {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('model crashed');
      };
      const err = await expectAiError(makeProvider().analyze(buildInput()), 'AI_HTTP_500');
      expect(err.message).toContain('500');
      expect(err.message).toContain('model crashed');
    });

    it('HTTP 401 (sai API key) -> AI_HTTP_401', async () => {
      handler = (_req, res) => {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ detail: 'Invalid API key' }));
      };
      await expectAiError(makeProvider({ apiKey: 'wrong' }).analyze(buildInput()), 'AI_HTTP_401');
    });

    it('body lỗi quá dài bị cắt (không đẩy cả trang lỗi vào message/DB)', async () => {
      handler = (_req, res) => {
        res.writeHead(502);
        res.end('x'.repeat(5000));
      };
      const err = await expectAiError(makeProvider().analyze(buildInput()), 'AI_HTTP_502');
      expect(err.message.length).toBeLessThan(600);
    });

    it('200 nhưng body không phải JSON -> AI_INVALID_RESPONSE', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html>not json</html>');
      };
      await expectAiError(makeProvider().analyze(buildInput()), 'AI_INVALID_RESPONSE');
    });

    it('200 + JSON sai hợp đồng (overallResult lạ) -> AI_INVALID_RESPONSE', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...VALID_RESULT, overallResult: 'bogus' }));
      };
      await expectAiError(makeProvider().analyze(buildInput()), 'AI_INVALID_RESPONSE');
    });

    it('200 + anomaly có score ngoài [0,1] -> AI_INVALID_RESPONSE (không ghi dữ liệu xấu vào DB)', async () => {
      handler = (_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ...VALID_RESULT, anomalies: [{ ...VALID_RESULT.anomalies[0], score: 7 }] }));
      };
      await expectAiError(makeProvider().analyze(buildInput()), 'AI_INVALID_RESPONSE');
    });

    it('server không trả lời trong timeoutMs -> AI_TIMEOUT', async () => {
      handler = (_req, res) => {
        // Giữ kết nối, trả lời quá muộn (timer được dọn trong afterEach)
        pendingTimers.add(setTimeout(() => res.end(JSON.stringify(VALID_RESULT)), 3000));
      };
      const started = Date.now();
      await expectAiError(makeProvider({ timeoutMs: 150 }).analyze(buildInput()), 'AI_TIMEOUT');
      expect(Date.now() - started).toBeLessThan(2000);
    });

    it('không kết nối được (cổng đóng) -> AI_UNAVAILABLE', async () => {
      // Lấy 1 cổng trống rồi đóng ngay để chắc chắn không có ai lắng nghe
      const tmp = createServer();
      await new Promise<void>((resolve) => tmp.listen(0, '127.0.0.1', resolve));
      const closedPort = (tmp.address() as AddressInfo).port;
      await new Promise<void>((resolve) => tmp.close(() => resolve()));

      await expectAiError(
        makeProvider({ baseUrl: `http://127.0.0.1:${closedPort}` }).analyze(buildInput()),
        'AI_UNAVAILABLE',
      );
    });
  });
});

describe('readEcgAiConfigFromEnv', () => {
  it('đọc ECG_AI_BASE_URL, ECG_AI_TIMEOUT_MS, ECG_AI_API_KEY (có trim)', () => {
    expect(
      readEcgAiConfigFromEnv({
        ECG_AI_BASE_URL: '  http://ecg-ai:8000  ',
        ECG_AI_TIMEOUT_MS: '15000',
        ECG_AI_API_KEY: ' key ',
      } as NodeJS.ProcessEnv),
    ).toEqual({ baseUrl: 'http://ecg-ai:8000', timeoutMs: 15000, apiKey: 'key' });
  });

  it('để trống / thiếu -> baseUrl & apiKey = undefined, timeout mặc định 60000', () => {
    expect(readEcgAiConfigFromEnv({ ECG_AI_BASE_URL: '', ECG_AI_API_KEY: '  ' } as NodeJS.ProcessEnv)).toEqual({
      baseUrl: undefined,
      timeoutMs: 60000,
      apiKey: undefined,
    });
  });

  it.each(['abc', '0', '-5'])('ECG_AI_TIMEOUT_MS không hợp lệ (%s) -> quay về 60000', (raw) => {
    expect(readEcgAiConfigFromEnv({ ECG_AI_TIMEOUT_MS: raw } as NodeJS.ProcessEnv).timeoutMs).toBe(60000);
  });
});