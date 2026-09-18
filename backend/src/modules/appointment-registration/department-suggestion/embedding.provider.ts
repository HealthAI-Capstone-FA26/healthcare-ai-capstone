// Trừu tượng hoá nguồn embedding: hệ thống có thể chạy với OpenAI, với Gemini, hoặc TẮT hẳn
// semantic search (khi không cấu hình provider nào) — DepartmentSuggestionService luôn phải chạy
// được kể cả khi provider = null hoặc lỗi (xem DepartmentEmbeddingService.embedText: bắt lỗi và
// trả về null thay vì throw để không chặn luồng gợi ý khoa).
export interface EmbeddingProvider {
  readonly name: string;
  embed(text: string): Promise<number[]>;
}

// Timeout ngắn (5s) cho mọi lời gọi embedding: đây chỉ là 1 tín hiệu BỔ SUNG cho keyword search,
// không đáng để người đặt lịch phải chờ lâu hoặc bị timeout cả API đặt lịch chỉ vì OpenAI/Gemini
// phản hồi chậm.
const EMBEDDING_TIMEOUT_MS = 5000;

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  private readonly apiKey = process.env.GEMINI_API_KEY;
  private readonly model = process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004';

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY chưa được cấu hình');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:embedContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: `models/${this.model}`,
        content: { parts: [{ text }] },
      }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    });

    if (!res.ok) {
      throw new Error(`Gemini embeddings API lỗi (${res.status}): ${await res.text()}`);
    }

    const data = (await res.json()) as { embedding: { values: number[] } };
    const vector = data.embedding?.values;
    if (!vector) {
      throw new Error('Gemini embeddings API trả về dữ liệu không hợp lệ');
    }
    return vector;
  }
}

// Chọn provider qua env DEPARTMENT_SUGGESTION_EMBEDDING_PROVIDER=openai|gemini. Để trống hoặc giá
// trị khác -> semantic search bị tắt, hệ thống tự động chạy keyword-only (không throw, không cần
// đổi code chỗ khác) — đảm bảo môi trường dev/test không có API key vẫn chạy được bình thường.
export function createEmbeddingProvider(): EmbeddingProvider | null {
  const providerName = (process.env.DEPARTMENT_SUGGESTION_EMBEDDING_PROVIDER || '').toLowerCase().trim();
  if (providerName === 'gemini') return new GeminiEmbeddingProvider();
  return null;
}
