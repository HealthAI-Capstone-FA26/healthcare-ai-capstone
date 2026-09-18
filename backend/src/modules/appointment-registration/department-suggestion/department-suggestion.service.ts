import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { DepartmentEmbeddingService } from './department-embedding.service';
import { cosineSimilarity } from './vector.util';
import { normalizeVietnameseText } from 'src/common/utils/vietnamese-text.util';

export interface DepartmentSuggestionResult {
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  score: number;
  keywordScore: number;
  semanticScore: number;
  matchedKeywords: string[];
  method: 'keyword' | 'semantic' | 'hybrid' | 'fallback';
}

// Khoa dùng làm gợi ý mặc định khi không khớp được từ khoá NÀO và semantic search cũng không có
const FALLBACK_DEPARTMENT_CODE = 'IM';

// Trọng số kết hợp: ưu tiên keyword hơn (do con người curate, chính xác theo domain y tế) nhưng
const KEYWORD_WEIGHT = 0.7;
const SEMANTIC_WEIGHT = 0.3;

const MIN_CONFIDENT_SCORE = 0.1;

const DECISIVE_KEYWORD_SCORE = 0.8;
const DECISIVE_MARGIN = 0.3;

@Injectable()
export class DepartmentSuggestionService {
  private readonly logger = new Logger(DepartmentSuggestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly departmentEmbeddingService: DepartmentEmbeddingService,
  ) { }

  async suggest(symptoms: string, limit = 3): Promise<DepartmentSuggestionResult[]> {
    const departments = await this.prisma.department.findMany({ where: { isActive: true } });
    if (departments.length === 0) return [];

    // 1. Keyword search — match trước, rồi loại bỏ xung đột "keyword chung chung lồng trong
    const normalizedInput = normalizeVietnameseText(symptoms);
    const rawMatches = departments.map((dept) => {
      const keywords = dept.symptomKeywords ?? [];
      const matchedKeywords = keywords.filter((kw) =>
        normalizedInput.includes(normalizeVietnameseText(kw)),
      );
      return { dept, matchedKeywords };
    });
    const dedupedMatches = this.resolveKeywordOverlaps(rawMatches);

    const keywordScored = dedupedMatches.map(({ dept, matchedKeywords }) => ({
      dept,
      matchedKeywords,
      keywordScore: this.computeKeywordScore(matchedKeywords),
    }));

    const rankedByKeyword = [...keywordScored].sort((a, b) => b.keywordScore - a.keywordScore);
    const topKeyword = rankedByKeyword[0];
    const secondKeyword = rankedByKeyword[1];
    const isDecisiveKeywordMatch =
      !!topKeyword &&
      topKeyword.keywordScore >= DECISIVE_KEYWORD_SCORE &&
      topKeyword.keywordScore - (secondKeyword?.keywordScore ?? 0) >= DECISIVE_MARGIN;

    // 2. Semantic search — CHỈ gọi khi keyword KHÔNG đủ quyết định (tiết kiệm gọi API embedding
    // cho case đã rõ ràng). Khi keyword mơ hồ/không khớp gì, bắt buộc chạy semantic để double-check
    // (đúng yêu cầu: keyword rõ -> đủ tin, keyword không rõ -> cần cả 2 tín hiệu).
    const semanticScores = new Map<string, number>();
    if (!isDecisiveKeywordMatch) {
      const inputEmbedding = await this.departmentEmbeddingService.embedText(symptoms);

      if (inputEmbedding) {
        // Lấy trước toàn bộ Vector của các khoa (Khoa nên lưu sẵn Vector trong DB / Redis Cache)
        const deptEmbeddings = await Promise.all(
          departments.map((dept) => this.departmentEmbeddingService.getDepartmentEmbedding(dept))
        );

        departments.forEach((dept, idx) => {
          const deptEmbedding = deptEmbeddings[idx];
          if (deptEmbedding) {
            const rawSimilarity = cosineSimilarity(inputEmbedding, deptEmbedding);
            // Chuẩn hóa điểm Cosine: Loại bỏ nhiễu nền (background noise < 0.3)
            const normalizedSemanticScore = Math.max(0, (rawSimilarity - 0.3) / 0.7);
            semanticScores.set(dept.departmentId, normalizedSemanticScore);
          }
        });
      }
    }

    const hasSemanticSignal = semanticScores.size > 0;

    // 3. Hybrid Scoring & Classification
    const combined: DepartmentSuggestionResult[] = keywordScored.map(({ dept, matchedKeywords, keywordScore }) => {
      const semanticScore = semanticScores.get(dept.departmentId) ?? 0;

      let score: number;
      let method: DepartmentSuggestionResult['method'];

      if (isDecisiveKeywordMatch) {
        score = keywordScore;
        method = matchedKeywords.length > 0 ? 'keyword' : 'fallback';
      } else {
        score = hasSemanticSignal
          ? KEYWORD_WEIGHT * keywordScore + SEMANTIC_WEIGHT * semanticScore
          : keywordScore;

        method = 'fallback';
        if (matchedKeywords.length > 0 && semanticScore >= 0.5) method = 'hybrid';
        else if (matchedKeywords.length > 0) method = 'keyword';
        else if (semanticScore >= 0.5) method = 'semantic';
      }

      return {
        departmentId: dept.departmentId,
        departmentCode: dept.departmentCode,
        departmentName: dept.departmentName,
        score,
        keywordScore,
        semanticScore,
        matchedKeywords,
        method,
      };
    });

    const ranked = combined.sort((a, b) => b.score - a.score);

    // 4. Fallback Handling
    if (ranked[0]?.score >= MIN_CONFIDENT_SCORE) {
      return ranked.slice(0, limit);
    }

    const fallback = departments.find((d) => d.departmentCode === FALLBACK_DEPARTMENT_CODE);
    return fallback
      ? [
        {
          departmentId: fallback.departmentId,
          departmentCode: fallback.departmentCode,
          departmentName: fallback.departmentName,
          score: 0,
          keywordScore: 0,
          semanticScore: 0,
          matchedKeywords: [],
          method: 'fallback',
        },
      ]
      : [];
  }

  // Dùng nội bộ bởi AppointmentService.createAtHospital: chỉ cần lấy thẳng departmentId khớp cao
  // nhất (flow tại quầy không có bước để người đặt lịch tự chọn giữa nhiều gợi ý).
  async suggestTopDepartmentId(symptoms: string): Promise<string> {
    const [top] = await this.suggest(symptoms, 1);
    if (!top) {
      throw new NotFoundException(
        'Không có khoa nào trong hệ thống để gợi ý dựa trên triệu chứng đã nhập',
      );
    }
    return top.departmentId;
  }

  // Loại bỏ xung đột keyword GIỮA CÁC KHOA: nếu keyword A (khoa X) là substring của keyword B
  // (khoa Y khác) — vd "sốt" (Nội) nằm trong "trẻ sốt" (Nhi) — thì A bị coi là chung chung hơn,
  // bị loại khỏi kết quả của khoa X, chỉ giữ lại match B ở khoa Y (khoa nào có keyword ĐẶC THÙ
  // hơn/dài hơn thì thắng). Nếu 2 khoa vô tình có đúng 1 keyword giống hệt nhau (dữ liệu seed lỗi)
  // thì log warning để soát lại seed, và giữ nguyên cả 2 (không đoán mò khoa nào đúng).
  // Generic <T> giữ nguyên kiểu đầy đủ của `dept` (Prisma entity) thay vì thu hẹp về vài field —
  // tránh lỗi mất field (vd departmentName) ở nơi gọi hàm.
  private resolveKeywordOverlaps<T extends { departmentId: string; departmentCode: string }>(
    matches: { dept: T; matchedKeywords: string[] }[],
  ): { dept: T; matchedKeywords: string[] }[] {
    const allEntries = matches.flatMap(({ dept, matchedKeywords }) =>
      matchedKeywords.map((kw) => ({ dept, keyword: kw, normalized: normalizeVietnameseText(kw) })),
    );

    const suppressed = new Set<string>();

    for (const a of allEntries) {
      for (const b of allEntries) {
        if (a.dept.departmentId === b.dept.departmentId) continue;
        if (a.normalized === b.normalized) {
          this.logger.warn(
            `Trùng keyword "${a.keyword}" giữa khoa ${a.dept.departmentCode} và ${b.dept.departmentCode} — cần soát lại seed để đảm bảo keyword duy nhất theo khoa.`,
          );
          continue;
        }
        // a là keyword chung chung hơn (ngắn hơn, bị chứa trong b) -> loại a khỏi khoa của nó.
        if (b.normalized.includes(a.normalized)) {
          suppressed.add(`${a.dept.departmentId}::${a.keyword}`);
        }
      }
    }

    return matches.map(({ dept, matchedKeywords }) => ({
      dept,
      matchedKeywords: matchedKeywords.filter((kw) => !suppressed.has(`${dept.departmentId}::${kw}`)),
    }));
  }

  // Điểm keyword dựa trên ĐỘ ĐẶC THÙ (số từ trong cụm khớp dài nhất) thay vì chỉ đếm số lượng
  // match — cụm càng dài/càng cụ thể (vd "đau ngực dữ dội") càng đáng tin hơn 1 từ đơn chung
  // chung (vd "sốt"). Khớp thêm nhiều keyword vẫn được cộng thêm điểm nhưng ở mức nhỏ.
  private computeKeywordScore(matchedKeywords: string[]): number {
    if (matchedKeywords.length === 0) return 0;

    const specificityOf = (kw: string): number => {
      const wordCount = normalizeVietnameseText(kw).split(/\s+/).filter(Boolean).length;
      if (wordCount >= 3) return 1.0;
      if (wordCount === 2) return 0.8;
      return 0.5; // 1 từ đơn -> tín hiệu yếu, chung chung
    };

    const bestSpecificity = Math.max(...matchedKeywords.map(specificityOf));
    const multiMatchBonus = 0.1 * (matchedKeywords.length - 1);

    return Math.min(1.0, bestSpecificity + multiMatchBonus);
  }
}
