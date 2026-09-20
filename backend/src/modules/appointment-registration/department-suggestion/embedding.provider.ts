import { Logger } from '@nestjs/common';

// Trừu tượng hoá nguồn embedding. Hiện chỉ triển khai Gemini; khi không cấu hình provider, semantic search
// bị TẮT và toàn bộ luồng gợi ý khoa chạy keyword-only (dev/test không cần API key).
export interface EmbeddingProvider {
  readonly name: string;
  /** Model cố định trong suốt vòng đời process -> vector cache theo text là an toàn. */
  readonly model: string;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

const SINGLE_TIMEOUT_MS = 5000;
const BATCH_TIMEOUT_MS = 15000;
const BATCH_LIMIT = 100; // giới hạn batchEmbedContents của Gemini API
const OUTPUT_DIMENSIONALITY = 768; // đủ tốt cho so khớp cụm ngắn, giảm 4x bộ nhớ/băng thông so với 3072

// LƯU Ý: `text-embedding-004` đã bị Google ngừng hỗ trợ từ 14/01/2026 -> mặc định phải là gemini-embedding-001.
const DEFAULT_GEMINI_MODEL = 'gemini-embedding-001';

function l2Normalize(vector: number[]): number[] {
  // Với outputDimensionality < 3072, Gemini KHÔNG tự chuẩn hoá vector.
  let sum = 0;
  for (const v of vector) sum += v * v;
  const norm = Math.sqrt(sum);
  return norm === 0 ? vector : vector.map((v) => v / norm);
}

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly model = process.env.GEMINI_EMBEDDING_MODEL || DEFAULT_GEMINI_MODEL;
  private readonly apiKey = process.env.GEMINI_API_KEY;
  private readonly baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  private async post<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY chưa được cấu hình');

    const res = await fetch(`${this.baseUrl}/models/${this.model}:${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Key đặt ở header, KHÔNG đặt trong query string (URL hay bị ghi vào access log/proxy log).
        'x-goog-api-key': this.apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`Gemini embeddings API lỗi (${res.status}): ${detail}`);
    }
    return (await res.json()) as T;
  }

  private buildRequest(text: string) {
    return {
      model: `models/${this.model}`,
      content: { parts: [{ text }] },
      // Cả 2 phía (mô tả của người dùng và cụm triệu chứng của khoa) đều là văn bản ngắn cùng loại -> đối xứng.
      taskType: 'SEMANTIC_SIMILARITY',
      outputDimensionality: OUTPUT_DIMENSIONALITY,
    };
  }

  async embed(text: string): Promise<number[]> {
    const data = await this.post<{ embedding?: { values?: number[] } }>('embedContent', this.buildRequest(text), SINGLE_TIMEOUT_MS);
    const values = data.embedding?.values;
    if (!values?.length) throw new Error('Gemini embeddings API trả về dữ liệu không hợp lệ');
    return l2Normalize(values);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += BATCH_LIMIT) {
      const chunk = texts.slice(i, i + BATCH_LIMIT);
      const data = await this.post<{ embeddings?: { values?: number[] }[] }>(
        'batchEmbedContents',
        { requests: chunk.map((t) => this.buildRequest(t)) },
        BATCH_TIMEOUT_MS,
      );
      const embeddings = data.embeddings;
      if (!embeddings || embeddings.length !== chunk.length || embeddings.some((e) => !e.values?.length)) {
        throw new Error('Gemini batchEmbedContents trả về dữ liệu không hợp lệ');
      }
      out.push(...embeddings.map((e) => l2Normalize(e.values as number[])));
    }
    return out;
  }
}

// Chọn provider qua env DEPARTMENT_SUGGESTION_EMBEDDING_PROVIDER=gemini. Để trống -> tắt semantic.
// Giá trị không hợp lệ (gõ sai, "openai" chưa được triển khai...) -> CẢNH BÁO to rõ thay vì tắt âm thầm.
export function createEmbeddingProvider(logger?: Logger): EmbeddingProvider | null {
  const name = (process.env.DEPARTMENT_SUGGESTION_EMBEDDING_PROVIDER || '').toLowerCase().trim();
  if (!name) return null;
  if (name === 'gemini') return new GeminiEmbeddingProvider();
  logger?.warn(`DEPARTMENT_SUGGESTION_EMBEDDING_PROVIDER="${name}" không được hỗ trợ (chỉ có "gemini") -> semantic search bị tắt`);
  return null;
}
