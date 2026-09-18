import { Injectable, Logger } from '@nestjs/common';
import { createEmbeddingProvider, EmbeddingProvider } from './embedding.provider';

interface DepartmentProfile {
  departmentId: string;
  departmentName: string;
  description: string | null;
  symptomKeywords: string[];
}

interface CachedEmbedding {
  vector: number[];
  cachedAt: number;
}

const DEPARTMENT_EMBEDDING_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DepartmentEmbeddingService {
  private readonly logger = new Logger(DepartmentEmbeddingService.name);
  private readonly provider: EmbeddingProvider | null = createEmbeddingProvider();
  private readonly departmentCache = new Map<string, CachedEmbedding>();

  isEnabled(): boolean {
    return this.provider !== null;
  }

  getProviderName(): string | null {
    return this.provider?.name ?? null;
  }

  // Best-effort: KHÔNG BAO GIỜ throw ra ngoài. Mọi lỗi (thiếu API key, timeout, quota, network...)
  // đều được log ở mức warn rồi trả về null, để DepartmentSuggestionService tự động fallback về
  // kết quả keyword-only — đúng yêu cầu "thoả mãn mọi tình huống", kể cả khi bên thứ 3 sập.
  async embedText(text: string): Promise<number[] | null> {
    if (!this.provider) return null;
    try {
      return await this.provider.embed(text);
    } catch (err) {
      this.logger.warn(
        `Semantic search (${this.provider.name}) tạm thời không dùng được, fallback keyword-only: ${(err as Error).message}`,
      );
      return null;
    }
  }

  async getDepartmentEmbedding(dept: DepartmentProfile): Promise<number[] | null> {
    const cached = this.departmentCache.get(dept.departmentId);
    if (cached && Date.now() - cached.cachedAt < DEPARTMENT_EMBEDDING_TTL_MS) {
      return cached.vector;
    }

    // Ghép tên khoa + mô tả + toàn bộ từ khoá triệu chứng thành 1 đoạn "hồ sơ khoa" để embed 1
    // lần — so khớp semantic thực chất là so sánh embedding(triệu chứng người dùng nhập) với
    // embedding(hồ sơ khoa) này bằng cosine similarity.
    const profileText = [dept.departmentName, dept.description, ...(dept.symptomKeywords ?? [])]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join('. ');

    const vector = await this.embedText(profileText);
    if (vector) {
      this.departmentCache.set(dept.departmentId, { vector, cachedAt: Date.now() });
    }
    return vector;
  }

  // Gọi khi seed lại danh mục khoa / cập nhật symptomKeywords để hồ sơ khoa được embed lại ngay,
  // không phải chờ hết TTL 24h.
  clearCache(): void {
    this.departmentCache.clear();
  }
}
