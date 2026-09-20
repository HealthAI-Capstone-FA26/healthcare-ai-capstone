// Bộ so khớp cụm từ tiếng Việt theo TOKEN (âm tiết), thay cho `String.includes` trên chuỗi đã bỏ dấu.
//
// Vì sao không dùng includes + bỏ dấu:
//  - "khong".includes("ho") === true  -> "không" bị hiểu là "ho" (ho = triệu chứng).
//  - "hong".includes("ho") === true   -> "họng" bị hiểu là "ho".
//  - "dieu tri".includes("tri")       -> "điều trị" bị hiểu là "trĩ" (bệnh trĩ).
// Vì vậy: (1) so khớp theo ranh giới token, (2) ưu tiên so khớp CÓ dấu, (3) chỉ cho phép
// so khớp KHÔNG dấu khi người dùng thực sự gõ không dấu và cụm từ khoá có >= 2 âm tiết.

export interface TokenizedText {
  /** Token đã lowercase, NFC, chuẩn hoá vị trí dấu (hoà/hòa), vẫn giữ dấu. */
  exact: string[];
  /** Cùng độ dài với `exact`, đã bỏ dấu (đ -> d). */
  plain: string[];
}

export interface PhraseHit {
  phrase: string;
  /** Vị trí token bắt đầu (inclusive). */
  start: number;
  /** Vị trí token kết thúc (exclusive). */
  end: number;
  /** true = khớp đúng dấu; false = khớp nhờ người dùng gõ không dấu. */
  exact: boolean;
}

export interface FindPhraseOptions {
  /** Cho phép khớp không dấu với cụm 1 âm tiết (chỉ dùng cho lớp cảnh báo cấp cứu: thà báo dư còn hơn bỏ sót). */
  allowPlainSingleSyllable?: boolean;
  /** Bỏ qua kiểm tra phủ định (dùng cho các cụm "ngữ cảnh" như unless). */
  ignoreNegation?: boolean;
}

// "hoà" (kiểu cũ) và "hòa" (kiểu mới) là cùng 1 từ; đưa về 1 dạng để so khớp ổn định.
const OLD_TONE_TO_NEW: Record<string, string> = {
  oà: 'òa', oá: 'óa', oả: 'ỏa', oã: 'õa', oạ: 'ọa',
  oè: 'òe', oé: 'óe', oẻ: 'ỏe', oẽ: 'õe', oẹ: 'ọe',
  uỳ: 'ùy', uý: 'úy', uỷ: 'ủy', uỹ: 'ũy', uỵ: 'ụy',
};
const OLD_TONE_REGEX = new RegExp(Object.keys(OLD_TONE_TO_NEW).join('|'), 'g');

export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');
}

export function tokenize(text: string): TokenizedText {
  const normalized = (text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(OLD_TONE_REGEX, (m) => OLD_TONE_TO_NEW[m]);
  const exact = normalized.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  return { exact, plain: exact.map(stripDiacritics) };
}

const phraseTokenCache = new Map<string, TokenizedText>();
function tokenizePhrase(phrase: string): TokenizedText {
  let cached = phraseTokenCache.get(phrase);
  if (!cached) {
    cached = tokenize(phrase);
    phraseTokenCache.set(phrase, cached);
  }
  return cached;
}

/** Số âm tiết (token) của cụm từ khoá — dùng làm proxy cho độ đặc hiệu. */
export function phraseSyllables(phrase: string): number {
  return tokenizePhrase(phrase).exact.length;
}

// Từ phủ định đứng ngay trước triệu chứng ("không sốt", "chưa đau ngực", "hết ho").
const NEGATORS = new Set(['không', 'chẳng', 'chưa', 'hết', 'khỏi', 'ko', 'hông', 'khong', 'chang', 'chua', 'het', 'hok']);
const NEGATION_WINDOW = 2;

function isNegated(input: TokenizedText, start: number): boolean {
  for (let k = start - 1; k >= Math.max(0, start - NEGATION_WINDOW); k--) {
    if (NEGATORS.has(input.exact[k]) || NEGATORS.has(input.plain[k])) {
      const next = input.exact[k + 1];
      // "không chỉ đau đầu mà còn sốt" -> KHÔNG phải phủ định.
      if (next === 'chỉ' || next === 'những') return false;
      return true;
    }
  }
  return false;
}

function exactMatchAt(input: string[], phrase: string[], at: number): boolean {
  for (let j = 0; j < phrase.length; j++) if (input[at + j] !== phrase[j]) return false;
  return true;
}

function plainMatchAt(input: TokenizedText, phrase: string[], at: number): boolean {
  for (let j = 0; j < phrase.length; j++) {
    // Chỉ chấp nhận khi CHÍNH token của người dùng đã không dấu ("dau" chứ không phải "đâu"/"đầu").
    if (input.exact[at + j] !== input.plain[at + j]) return false;
    if (input.plain[at + j] !== phrase[j]) return false;
  }
  return true;
}

/** Tìm lần xuất hiện đầu tiên (không bị phủ định) của `phrase` trong `input`. */
export function findPhrase(input: TokenizedText, phrase: string, options: FindPhraseOptions = {}): PhraseHit | null {
  const pt = tokenizePhrase(phrase);
  const n = pt.exact.length;
  if (n === 0 || n > input.exact.length) return null;

  const allowPlain = n >= 2 || options.allowPlainSingleSyllable === true;
  let plainCandidate: PhraseHit | null = null;

  for (let i = 0; i + n <= input.exact.length; i++) {
    if (exactMatchAt(input.exact, pt.exact, i)) {
      if (options.ignoreNegation || !isNegated(input, i)) {
        return { phrase, start: i, end: i + n, exact: true };
      }
      continue;
    }
    if (allowPlain && !plainCandidate && plainMatchAt(input, pt.plain, i)) {
      if (options.ignoreNegation || !isNegated(input, i)) {
        plainCandidate = { phrase, start: i, end: i + n, exact: false };
      }
    }
  }
  return plainCandidate;
}

/** Chuẩn hoá cụm từ khoá thành khoá so sánh (dùng để phát hiện trùng lặp trong seed). */
export function keywordIdentity(phrase: string): string {
  return tokenizePhrase(phrase).plain.join(' ');
}
