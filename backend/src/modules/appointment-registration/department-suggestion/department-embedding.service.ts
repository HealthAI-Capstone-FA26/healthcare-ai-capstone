import { Injectable, Logger } from '@nestjs/common';
import { createEmbeddingProvider, EmbeddingProvider } from './embedding.provider';

// Sau 1 lần lỗi provider, tạm ngưng gọi ra ngoài trong khoảng này để KHÔNG bắt mọi request phải chờ
// hết timeout 5s khi Google đang sự cố (circuit breaker đơn giản).
const CIRCUIT_OPEN_MS = 30_000;

// Che số điện thoại / email / dãy số dài (CCCD, mã BHYT...) trước khi gửi ra bên thứ 3.
// Mô tả triệu chứng là dữ liệu sức khoẻ (dữ liệu cá nhân nhạy cảm theo NĐ 13/2023/NĐ-CP) — tối thiểu hoá là bắt buộc.
export function sanitizeForExternalCall(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/(\+?84|0)[\s.-]?\d(?:[\s.-]?\d){8,9}/g, '[sdt]')
    .replace(/\d[\d\s.-]{7,}\d/g, '[so]');
}

@Injectable()
export class DepartmentEmbeddingService {
  private readonly logger = new Logger(DepartmentEmbeddingService.name);
  private readonly provider: EmbeddingProvider | null = createEmbeddingProvider(this.logger);

  // Cache theo NỘI DUNG cụm từ (không theo departmentId + TTL như trước): đổi seed/keyword thì cụm mới
  // tự được embed, cụm cũ giữ nguyên -> không cần clearCache(), không có cửa sổ 24h dùng dữ liệu cũ.
  // Kích thước bị chặn bởi tổng số keyword (~vài trăm cụm x 768 float).
  private readonly phraseVectors = new Map<string, number[]>();
  private readonly inflight = new Map<string, Promise<boolean>>();
  private circuitOpenUntil = 0;

  isEnabled(): boolean {
    return this.provider !== null;
  }

  getProviderName(): string | null {
    return this.provider?.name ?? null;
  }

  private circuitOpen(): boolean {
    return Date.now() < this.circuitOpenUntil;
  }

  private tripCircuit(err: unknown): void {
    this.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    // Không log nội dung triệu chứng — chỉ log lỗi kỹ thuật.
    this.logger.warn(
      `Semantic search (${this.provider?.name}) tạm thời không dùng được, keyword-only trong ${CIRCUIT_OPEN_MS / 1000}s: ${(err as Error).message}`,
    );
  }

  // Best-effort: KHÔNG BAO GIỜ throw ra ngoài.
  async embedQuery(text: string): Promise<number[] | null> {
    if (!this.provider || this.circuitOpen()) return null;
    try {
      return await this.provider.embed(sanitizeForExternalCall(text));
    } catch (err) {
      this.tripCircuit(err);
      return null;
    }
  }

  /** Đảm bảo mọi cụm đã có vector trong cache. Trả về false nếu không thể (tắt/lỗi) -> caller dùng keyword-only. */
  async ensurePhraseVectors(phrases: string[]): Promise<boolean> {
    if (!this.provider || this.circuitOpen()) return false;

    const missing = [...new Set(phrases)].filter((p) => p && !this.phraseVectors.has(p)).sort();
    if (missing.length === 0) return true;

    // Dedupe request đồng thời: nhiều request cùng lúc khi cache lạnh chỉ tạo 1 lượt gọi API (chống cache stampede).
    const key = missing.join('\u0000');
    const existing = this.inflight.get(key);
    if (existing) return existing;

    const task = (async () => {
      try {
        const vectors = await (this.provider as EmbeddingProvider).embedBatch(missing);
        missing.forEach((phrase, i) => this.phraseVectors.set(phrase, vectors[i]));
        return true;
      } catch (err) {
        this.tripCircuit(err);
        return false;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, task);
    return task;
  }

  getPhraseVector(phrase: string): number[] | undefined {
    return this.phraseVectors.get(phrase);
  }

  /** Dùng khi cần ép embed lại (đổi model qua env rồi restart thì không cần gọi hàm này). */
  clearCache(): void {
    this.phraseVectors.clear();
  }
}
