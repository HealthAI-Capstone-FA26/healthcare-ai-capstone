import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from 'prisma/prisma.service';
import { DepartmentEmbeddingService } from './department-embedding.service';
import {
  DepartmentSuggestionResult,
  SuggestionConfidence,
  SuggestionMethod,
} from './dto/suggest-department.dto';
import { detectEmergency, EmergencyDetection } from './emergency-red-flags';
import { findPhrase, keywordIdentity, phraseSyllables, PhraseHit, tokenize, TokenizedText } from './keyword-matcher.util';
import { derivePatientContext, PatientContext } from './patient-context.util';
import { cosineSimilarity } from './vector.util';

// ───────────────────────────── Cấu hình ─────────────────────────────
// Mã khoa trong seed. Khoa Cấp cứu & khoa tiếp nhận (Khám bệnh) là 2 "neo" an toàn của luồng gợi ý.
const EMERGENCY_DEPARTMENT_CODE = 'ER';
const PEDIATRIC_DEPARTMENT_CODE = 'PED';
const NEONATAL_DEPARTMENT_CODE = 'NEO';
const FALLBACK_DEPARTMENT_CODES = ['GEN', 'IM'] as const; // Khám bệnh -> Nội tổng hợp
// Bệnh nhi có triệu chứng "nội khoa" chung thì đi Khoa Nhi, không phải Nội người lớn. ENT được đưa vào vì viêm
// đường hô hấp trên (đau họng, sổ mũi, viêm amidan...) là nhóm bệnh nhi phổ biến nhất. Chuyên khoa hẹp
// (Mắt, Răng, Da liễu, Tiết niệu, Chỉnh hình, Ung bướu...) KHÔNG bị định tuyến lại.
const PEDIATRIC_REROUTE_CODES = new Set(['IM', 'RESP', 'GI', 'GEN', 'ENT']);

const PEDIATRIC_PREFIX = /^(trẻ|bé|con) /;

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;
const DEPARTMENT_CACHE_TTL_MS = 60_000;

// Độ đặc hiệu theo số âm tiết của từ khoá (1 âm tiết như "ho", "sốt" rất mơ hồ; >= 3 âm tiết gần như chắc chắn).
const WEIGHT_1_SYLLABLE = 0.45;
const WEIGHT_2_SYLLABLES = 0.75;
const WEIGHT_3_PLUS_SYLLABLES = 0.95;
const PLAIN_MATCH_PENALTY = 0.9; // khớp nhờ người dùng gõ không dấu -> kém chắc chắn hơn chút
const EXTRA_KEYWORD_BONUS = 0.1; // mỗi từ khoá phân biệt bổ sung

const DECISIVE_SCORE = 0.75;
const DECISIVE_MARGIN = 0.25;
const MEDIUM_CONFIDENCE_SCORE = 0.45;

const PEDIATRIC_CONTEXT_BONUS = 0.1;
const PEDIATRIC_ONLY_SCORE = 0.3;
const SOURCE_DEMOTION = 0.5; // khoa người lớn bị hạ điểm khi bệnh nhân là trẻ em
const NEONATE_MIN_SCORE = 0.6;

const SEMANTIC_BOOST = 0.2; // cộng thêm cho khoa ĐÃ có từ khoá và được semantic ủng hộ
const SEMANTIC_ONLY_BASE = 0.3; // khoa chỉ có semantic: [0.30, 0.60] -> luôn confidence thấp/trung bình
const SEMANTIC_ONLY_RANGE = 0.3;

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
// CẦN HIỆU CHUẨN với bộ câu hỏi thật của bệnh viện trước khi bật semantic ở production (xem REVIEW.md, mục 6).
// Ngưỡng dưới đây là điểm khởi đầu thận trọng cho gemini-embedding-001 (cosine giữa các cụm ngắn không liên quan
// thường ~0.5–0.65; liên quan ~0.75+).
const SEMANTIC_MIN_SIMILARITY = envNumber('DEPARTMENT_SUGGESTION_SEMANTIC_MIN_SIMILARITY', 0.72, 0.3, 0.99);

// ───────────────────────────── Kiểu nội bộ ─────────────────────────────
interface DepartmentRecord {
  departmentId: string;
  departmentCode: string;
  departmentName: string;
  description: string | null;
  symptomKeywords: string[] | null;
}

interface Candidate {
  dept: DepartmentRecord;
  hits: PhraseHit[];
  keywordScore: number;
  contextScore: number;
  contextReasons: string[];
  multiplier: number;
  semanticSimilarity: number;
  semanticNorm: number;
  extraKeywords: string[]; // từ khoá "đi nhờ" từ khoa khác khi định tuyến nhi khoa
}

export interface SuggestOptions {
  /** Tuổi (năm) của người sẽ đi khám; nếu có sẽ thắng mọi suy luận từ văn bản. */
  patientAgeYears?: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const baseScore = (c: Candidate) => Math.max(c.keywordScore, c.contextScore) * c.multiplier;

@Injectable()
export class DepartmentSuggestionService implements OnModuleInit {
  private readonly logger = new Logger(DepartmentSuggestionService.name);
  private departmentCache: { at: number; data: DepartmentRecord[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly departmentEmbeddingService: DepartmentEmbeddingService,
  ) {}

  // Làm nóng cache embedding ở nền để request đầu tiên không phải chờ ~1000 cụm được embed.
  onModuleInit(): void {
    if (!this.departmentEmbeddingService.isEnabled()) return;
    void this.loadDepartments()
      .then((departments) => this.departmentEmbeddingService.ensurePhraseVectors(this.collectPhrases(departments)))
      .catch((err: Error) => this.logger.warn(`Warm-up embedding thất bại: ${err.message}`));
  }

  /** Gọi sau khi seed/sửa danh mục khoa để áp dụng ngay, không chờ hết TTL. */
  invalidateDepartmentCache(): void {
    this.departmentCache = null;
  }

  // ───────────────────────────── API chính ─────────────────────────────
  async suggest(symptoms: string, limit = DEFAULT_LIMIT, options: SuggestOptions = {}): Promise<DepartmentSuggestionResult[]> {
    const departments = await this.loadDepartments();
    if (departments.length === 0) return [];

    const take = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const tokens = tokenize(symptoms);
    const patient = derivePatientContext(tokens, options.patientAgeYears);
    const emergency = detectEmergency(tokens);

    // 1. Keyword (token-based) -> 2. ngữ cảnh nhi khoa -> 3. semantic (chỉ khi cần)
    const candidates = this.scoreByKeywords(departments, tokens, patient);
    this.applyPatientContext(candidates, patient);

    if (!emergency.isEmergency && !this.isDecisive(candidates)) {
      await this.applySemantic(symptoms, departments, candidates);
    }

    // 4. Kết hợp điểm + xếp hạng
    let results = this.toResults(candidates);

    // 5. Không có tín hiệu nào -> khoa tiếp nhận (KHÔNG âm thầm gán Nội khoa như trước)
    if (results.length === 0) {
      const fallback = this.buildFallback(departments, patient);
      if (!fallback) return [];
      results = [fallback];
    }

    // 6. Ghim Khoa Cấp cứu lên đầu nếu có dấu hiệu nguy hiểm (ghi đè mọi kết quả khác)
    if (emergency.isEmergency) {
      results = this.applyEmergency(results, departments, emergency);
    }

    return this.assignConfidence(results).slice(0, take);
  }

  async suggestTopDepartmentId(symptoms: string, options: SuggestOptions = {}): Promise<string> {
    const [top] = await this.suggest(symptoms, 1, options);
    if (!top) {
      throw new NotFoundException('Không có khoa nào trong hệ thống để gợi ý dựa trên triệu chứng đã nhập');
    }
    return top.departmentId;
  }

  // ───────────────────────────── Dữ liệu khoa ─────────────────────────────
  private async loadDepartments(): Promise<DepartmentRecord[]> {
    const now = Date.now();
    if (this.departmentCache && now - this.departmentCache.at < DEPARTMENT_CACHE_TTL_MS) {
      return this.departmentCache.data;
    }
    const data: DepartmentRecord[] = await this.prisma.department.findMany({
      where: { isActive: true },
      select: {
        departmentId: true,
        departmentCode: true,
        departmentName: true,
        description: true,
        symptomKeywords: true,
      },
    });
    this.departmentCache = { at: now, data };
    this.warnDuplicateKeywords(data);
    return data;
  }

  // Chạy 1 lần mỗi lần nạp lại cache (trước đây chạy O(n²) + log warn ở MỌI request).
  private warnDuplicateKeywords(departments: DepartmentRecord[]): void {
    const owners = new Map<string, Set<string>>();
    for (const dept of departments) {
      for (const kw of dept.symptomKeywords ?? []) {
        const id = keywordIdentity(kw);
        if (!owners.has(id)) owners.set(id, new Set());
        owners.get(id)?.add(dept.departmentCode);
      }
    }
    for (const [id, codes] of owners) {
      if (codes.size > 1) {
        this.logger.warn(`Từ khoá "${id}" trùng giữa các khoa [${[...codes].join(', ')}] — cần soát lại seed.`);
      }
    }
  }

  private collectPhrases(departments: DepartmentRecord[]): string[] {
    return departments.flatMap((d) => [d.departmentName, ...(d.symptomKeywords ?? [])]);
  }

  // ───────────────────────────── Keyword ─────────────────────────────
  private scoreByKeywords(departments: DepartmentRecord[], tokens: TokenizedText, patient: PatientContext): Candidate[] {
    const found: { deptIndex: number; hit: PhraseHit }[] = [];
    departments.forEach((dept, deptIndex) => {
      for (const kw of new Set(dept.symptomKeywords ?? [])) {
        let hit = findPhrase(tokens, kw);
        // Ngữ cảnh nhi khoa: "bé bị nôn trớ" không chứa cụm liền mạch "bé nôn trớ". Đã biết là trẻ em rồi thì
        // tiền tố (trẻ/bé/con) của từ khoá Khoa Nhi là thừa -> thử lại với phần còn lại (>= 2 âm tiết).
        if (!hit && patient.isPediatric && dept.departmentCode === PEDIATRIC_DEPARTMENT_CODE) {
          const rest = kw.replace(PEDIATRIC_PREFIX, '');
          if (rest !== kw && phraseSyllables(rest) >= 2) hit = findPhrase(tokens, rest);
        }
        if (hit) found.push({ deptIndex, hit });
      }
    });

    // "Cụm dài nhất thắng": bỏ mọi hit nằm TRỌN trong 1 hit dài hơn (của bất kỳ khoa nào).
    // vd. "đau ngực dữ dội"(Cấp cứu) loại "đau ngực"(Tim mạch); "trẻ sốt"(Nhi) loại "sốt"(Nội).
    // Khác bản cũ: so theo VỊ TRÍ token thay vì `includes` trên chuỗi, và áp dụng cả trong cùng 1 khoa
    // (tránh cộng dồn điểm 2 lần cho "đau bụng" + "đau bụng dưới").
    const kept = found.filter(
      ({ hit: a }) =>
        !found.some(({ hit: b }) => b !== a && b.start <= a.start && b.end >= a.end && b.end - b.start > a.end - a.start),
    );

    return departments.map((dept, deptIndex) => {
      const seenSpans = new Set<string>();
      const hits = kept
        .filter((f) => f.deptIndex === deptIndex)
        .map((f) => f.hit)
        .filter((h) => {
          const key = `${h.start}-${h.end}`;
          if (seenSpans.has(key)) return false;
          seenSpans.add(key);
          return true;
        });
      return {
        dept,
        hits,
        keywordScore: this.computeKeywordScore(hits),
        contextScore: 0,
        contextReasons: [],
        multiplier: 1,
        semanticSimilarity: 0,
        semanticNorm: 0,
        extraKeywords: [],
      };
    });
  }

  private computeKeywordScore(hits: PhraseHit[]): number {
    if (hits.length === 0) return 0;
    const weightOf = (h: PhraseHit): number => {
      const syllables = phraseSyllables(h.phrase);
      const base =
        syllables >= 3 ? WEIGHT_3_PLUS_SYLLABLES : syllables === 2 ? WEIGHT_2_SYLLABLES : WEIGHT_1_SYLLABLE;
      return h.exact ? base : base * PLAIN_MATCH_PENALTY;
    };
    const best = Math.max(...hits.map(weightOf));
    return Math.min(1, best + EXTRA_KEYWORD_BONUS * (hits.length - 1));
  }

  private isDecisive(candidates: Candidate[]): boolean {
    const [top, second] = candidates.map(baseScore).sort((a, b) => b - a);
    return top >= DECISIVE_SCORE && top - (second ?? 0) >= DECISIVE_MARGIN;
  }

  // ───────────────────────────── Ngữ cảnh bệnh nhân ─────────────────────────────
  private applyPatientContext(candidates: Candidate[], patient: PatientContext): void {
    if (!patient.isPediatric) return;
    const byCode = new Map(candidates.map((c) => [c.dept.departmentCode, c]));
    const ped = byCode.get(PEDIATRIC_DEPARTMENT_CODE);
    if (!ped) return;

    const sources = [...PEDIATRIC_REROUTE_CODES]
      .map((code) => byCode.get(code))
      .filter((c): c is Candidate => !!c && c.keywordScore > 0);

    if (sources.length > 0) {
      const best = Math.max(ped.keywordScore, ...sources.map((s) => s.keywordScore));
      ped.contextScore = Math.min(1, best + PEDIATRIC_CONTEXT_BONUS);
      ped.extraKeywords.push(...sources.flatMap((s) => s.hits.map((h) => h.phrase)));
      sources.forEach((s) => (s.multiplier = SOURCE_DEMOTION));
    } else {
      ped.contextScore = Math.max(ped.contextScore, PEDIATRIC_ONLY_SCORE);
    }
    ped.contextReasons.push('Bệnh nhân là trẻ em (dưới 16 tuổi) nên ưu tiên Khoa Nhi');

    const neo = byCode.get(NEONATAL_DEPARTMENT_CODE);
    if (patient.isNeonate && neo) {
      neo.contextScore = Math.min(1, Math.max(neo.keywordScore, ped.contextScore, NEONATE_MIN_SCORE) + PEDIATRIC_CONTEXT_BONUS);
      neo.contextReasons.push('Trẻ sơ sinh (≤ 28 ngày tuổi) nên ưu tiên Trung tâm Sơ sinh');
    }
  }

  // ───────────────────────────── Semantic ─────────────────────────────
  private async applySemantic(symptoms: string, departments: DepartmentRecord[], candidates: Candidate[]): Promise<void> {
    if (!this.departmentEmbeddingService.isEnabled()) return;

    const [queryVector, ready] = await Promise.all([
      this.departmentEmbeddingService.embedQuery(symptoms),
      this.departmentEmbeddingService.ensurePhraseVectors(this.collectPhrases(departments)),
    ]);
    if (!queryVector || !ready) return; // lỗi/timeout -> keyword-only, không throw

    for (const candidate of candidates) {
      // So với TỪNG cụm triệu chứng của khoa và lấy max — thay vì 1 vector "hồ sơ khoa" trộn cả trăm từ
      // (vector trung bình bị nhoè nên cosine kém phân biệt).
      let best = 0;
      for (const phrase of [candidate.dept.departmentName, ...(candidate.dept.symptomKeywords ?? [])]) {
        const vector = this.departmentEmbeddingService.getPhraseVector(phrase);
        if (vector) best = Math.max(best, cosineSimilarity(queryVector, vector));
      }
      candidate.semanticSimilarity = best;
      candidate.semanticNorm =
        best >= SEMANTIC_MIN_SIMILARITY ? (best - SEMANTIC_MIN_SIMILARITY) / (1 - SEMANTIC_MIN_SIMILARITY) : 0;
    }
  }

  // ───────────────────────────── Kết quả ─────────────────────────────
  private toResults(candidates: Candidate[]): DepartmentSuggestionResult[] {
    const results: DepartmentSuggestionResult[] = [];

    for (const c of candidates) {
      const base = baseScore(c);
      let score = 0;
      let method: SuggestionMethod = 'fallback';
      const reasons: string[] = [];

      if (base > 0 && c.semanticNorm > 0) {
        score = Math.min(1, base + SEMANTIC_BOOST * c.semanticNorm); // chỉ CỘNG, không bao giờ làm giảm điểm keyword
        method = 'hybrid';
      } else if (base > 0) {
        score = base;
        method = c.keywordScore > 0 ? 'keyword' : 'context';
      } else if (c.semanticNorm > 0) {
        // Bản cũ: điểm semantic-only tối đa 0.4 nhưng ngưỡng chấp nhận cũng 0.4 -> nhánh này CHẾT, không bao giờ thắng.
        score = SEMANTIC_ONLY_BASE + SEMANTIC_ONLY_RANGE * c.semanticNorm;
        method = 'semantic';
      }
      if (score <= 0) continue;

      const matched = [...new Set([...c.hits.map((h) => h.phrase), ...c.extraKeywords])];
      if (matched.length) reasons.push(`Khớp từ khoá: ${matched.map((m) => `"${m}"`).join(', ')}`);
      reasons.push(...c.contextReasons);
      if (c.semanticNorm > 0) {
        reasons.push(`Mô tả tương đồng ngữ nghĩa với triệu chứng của khoa (cosine ${round3(c.semanticSimilarity)})`);
      }

      results.push({
        departmentId: c.dept.departmentId,
        departmentCode: c.dept.departmentCode,
        departmentName: c.dept.departmentName,
        score: round3(score),
        keywordScore: round3(c.keywordScore),
        semanticScore: round3(c.semanticSimilarity),
        matchedKeywords: matched,
        method,
        confidence: 'low',
        isEmergency: false,
        reasons,
      });
    }

    return results.sort(
      (a, b) =>
        b.score - a.score ||
        b.keywordScore - a.keywordScore ||
        a.departmentCode.localeCompare(b.departmentCode),
    );
  }

  private applyEmergency(
    results: DepartmentSuggestionResult[],
    departments: DepartmentRecord[],
    emergency: EmergencyDetection,
  ): DepartmentSuggestionResult[] {
    const emergencyReasons = emergency.reasons.map((r) => `Dấu hiệu cấp cứu: ${r}`);
    const others = results.filter((r) => r.departmentCode !== EMERGENCY_DEPARTMENT_CODE && r.method !== 'fallback');
    const matchedEr = results.find((r) => r.departmentCode === EMERGENCY_DEPARTMENT_CODE);
    const er = departments.find((d) => d.departmentCode === EMERGENCY_DEPARTMENT_CODE);

    const pin = (base: DepartmentSuggestionResult): DepartmentSuggestionResult => ({
      ...base,
      score: 1,
      method: 'emergency',
      confidence: 'high',
      isEmergency: true,
      advice: emergency.advice,
      reasons: [...emergencyReasons, ...base.reasons.filter((r) => !r.startsWith('Chưa nhận diện'))],
    });

    if (matchedEr) return [pin(matchedEr), ...others];
    if (er) {
      return [
        pin({
          departmentId: er.departmentId,
          departmentCode: er.departmentCode,
          departmentName: er.departmentName,
          score: 0,
          keywordScore: 0,
          semanticScore: 0,
          matchedKeywords: [],
          method: 'emergency',
          confidence: 'high',
          isEmergency: true,
          reasons: [],
        }),
        ...others,
      ];
    }
    // DB không có Khoa Cấp cứu: vẫn tuyệt đối không được nuốt cảnh báo -> gắn lên kết quả đầu tiên.
    return [pin(results[0]), ...results.slice(1)];
  }

  private assignConfidence(results: DepartmentSuggestionResult[]): DepartmentSuggestionResult[] {
    return results.map((r, index) => {
      if (r.isEmergency) return r;
      let confidence: SuggestionConfidence = r.score >= MEDIUM_CONFIDENCE_SCORE ? 'medium' : 'low';
      if (index === 0) {
        const second = results[1]?.score ?? 0;
        if (r.score >= DECISIVE_SCORE && r.score - second >= DECISIVE_MARGIN) confidence = 'high';
      }
      // Kết quả chỉ dựa vào semantic không bao giờ được coi là "high".
      if (r.method === 'semantic' && confidence === 'high') confidence = 'medium';
      return { ...r, confidence };
    });
  }

  private buildFallback(departments: DepartmentRecord[], patient: PatientContext): DepartmentSuggestionResult | null {
    const codes = patient.isPediatric
      ? [PEDIATRIC_DEPARTMENT_CODE, ...FALLBACK_DEPARTMENT_CODES]
      : [...FALLBACK_DEPARTMENT_CODES];
    const dept =
      codes.map((code) => departments.find((d) => d.departmentCode === code)).find(Boolean) ?? departments[0];
    if (!dept) return null;

    return {
      departmentId: dept.departmentId,
      departmentCode: dept.departmentCode,
      departmentName: dept.departmentName,
      score: 0,
      keywordScore: 0,
      semanticScore: 0,
      matchedKeywords: [],
      method: 'fallback',
      confidence: 'low',
      isEmergency: false,
      reasons: ['Chưa nhận diện được triệu chứng cụ thể — chuyển về khoa tiếp nhận để được hướng dẫn chọn chuyên khoa'],
    };
  }
}
