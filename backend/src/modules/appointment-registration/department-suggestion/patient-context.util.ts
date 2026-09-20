import { TokenizedText } from './keyword-matcher.util';

export const PEDIATRIC_MAX_AGE_YEARS = 16; // Luật Trẻ em: dưới 16 tuổi
export const NEONATE_MAX_AGE_YEARS = 28 / 365; // sơ sinh: <= 28 ngày tuổi

export interface PatientContext {
  isPediatric: boolean;
  isNeonate: boolean;
  source: 'param' | 'text' | 'none';
}

// "trẻ hóa da"/"trẻ trung" không phải ngữ cảnh nhi khoa.
const PEDIATRIC_CUE =
  /(^| )(trẻ em|trẻ nhỏ|em bé|cháu bé|bé trai|bé gái|con nhỏ|con tôi|con mình|con em|con anh|con chị|con gái|con trai|bé|trẻ(?! (hóa|trung)))( |$)/;
const NEONATE_CUE = /(^| )(sơ sinh|mới sinh)( |$)/;
const AGE_YEARS = /(?:^| )(\d{1,3}) tuổi(?: |$)/;
const AGE_SMALL_UNIT = /(?:^| )(\d{1,3}) (ngày|tuần|tháng) tuổi(?: |$)/;

/**
 * Suy ra ngữ cảnh bệnh nhân. Tuổi truyền tường minh (từ hồ sơ/ngày sinh) luôn thắng suy luận từ văn bản,
 * vì người đặt lịch hộ thường viết "con tôi", "bé nhà mình" — hoặc ngược lại "con tôi 30 tuổi".
 */
export function derivePatientContext(tokens: TokenizedText, ageYears?: number): PatientContext {
  if (typeof ageYears === 'number' && Number.isFinite(ageYears) && ageYears >= 0) {
    return {
      isPediatric: ageYears < PEDIATRIC_MAX_AGE_YEARS,
      isNeonate: ageYears <= NEONATE_MAX_AGE_YEARS,
      source: 'param',
    };
  }

  const joined = tokens.exact.join(' ');

  const small = AGE_SMALL_UNIT.exec(joined);
  if (small) {
    const value = Number(small[1]);
    const unit = small[2];
    const neonate = (unit === 'ngày' && value <= 28) || (unit === 'tuần' && value <= 4);
    return { isPediatric: true, isNeonate: neonate, source: 'text' };
  }

  const years = AGE_YEARS.exec(joined);
  if (years) {
    const value = Number(years[1]);
    return { isPediatric: value < PEDIATRIC_MAX_AGE_YEARS, isNeonate: false, source: 'text' };
  }

  if (NEONATE_CUE.test(joined)) return { isPediatric: true, isNeonate: true, source: 'text' };
  if (PEDIATRIC_CUE.test(joined)) return { isPediatric: true, isNeonate: false, source: 'text' };

  return { isPediatric: false, isNeonate: false, source: 'none' };
}
