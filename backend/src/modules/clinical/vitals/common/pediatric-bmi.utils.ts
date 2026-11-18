import { BmiLmsEntry, CDC_BMI_LMS_FEMALE, CDC_BMI_LMS_MALE } from './cdc-bmi-lms.data';

/**
 * Tính BMI theo tuổi cho bệnh nhi (2–20 tuổi) dựa trên phương pháp LMS của CDC —
 * cùng phương pháp mà peditools.org/growthpedi và BCM BMI-calculator-kids sử dụng.
 *
 * Vì sao cần tách riêng thay vì dùng chung 1 khoảng BMI cố định (VD 18.5–24.9) như
 * người lớn: với trẻ em, "bình thường" phụ thuộc cả vào tuổi lẫn giới tính (một BMI
 * là bình thường ở tuổi này có thể là thừa cân ở tuổi khác), nên CDC không dùng
 * ngưỡng BMI tuyệt đối mà dùng percentile so với quần thể tham chiếu cùng tuổi/giới.
 *
 * Giới hạn áp dụng: 24.0–239.8 tháng tuổi (2 đến <20 tuổi). Dưới 24 tháng, CDC/WHO
 * khuyến nghị dùng chỉ số weight-for-length thay vì BMI-for-age nên hàm này KHÔNG
 * áp dụng cho trẻ dưới 2 tuổi (trả về null — nơi gọi cần tự xử lý, KHÔNG suy diễn
 * thêm ngưỡng cho nhóm tuổi này vì dễ sai lệch y khoa).
 */

export type PatientSex = 'male' | 'female';

/** Ngưỡng phân loại percentile BMI-for-age theo CDC (áp dụng cho 2–<20 tuổi). */
export const PEDIATRIC_BMI_PERCENTILE_CUTOFF = {
    UNDERWEIGHT_MAX: 5, // < 5th percentile: thiếu cân
    HEALTHY_MAX: 85, // 5th – <85th percentile: bình thường
    OVERWEIGHT_MAX: 95, // 85th – <95th percentile: thừa cân; >=95th: béo phì
} as const;

export type PediatricBmiCategory = 'UNDERWEIGHT' | 'HEALTHY' | 'OVERWEIGHT' | 'OBESE';

export interface PediatricBmiAssessment {
    ageMonths: number;
    sex: PatientSex;
    bmi: number;
    zScore: number;
    percentile: number;
    category: PediatricBmiCategory;
}

const MIN_AGE_MONTHS = 24.0;
const MAX_AGE_MONTHS = 239.8;

/**
 * Chuẩn hoá các quy ước lưu giới tính thường gặp (MALE/FEMALE, M/F, Nam/Nữ, mã CDC
 * 1=nam/2=nữ...) về 'male' | 'female'. Điều chỉnh lại nếu enum Gender thực tế trong
 * schema Patient khác với các giá trị liệt kê ở đây.
 */
export function normalizePatientSex(gender: string | null | undefined): PatientSex | null {
    if (!gender) return null;
    const g = gender.trim().toUpperCase();
    if (['MALE', 'M', 'NAM', '1'].includes(g)) return 'male';
    if (['FEMALE', 'F', 'NU', 'NỮ', '2'].includes(g)) return 'female';
    return null;
}

/** age tính bằng tháng (số thực), chính xác hơn calculateAge (vốn chỉ ra số năm tròn) — cần cho nội suy LMS. */
export function calculateAgeInMonths(dateOfBirth: Date, measuredAt: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000;
    const diffDays = (measuredAt.getTime() - dateOfBirth.getTime()) / msPerDay;
    return diffDays / (365.25 / 12);
}

function getLmsTable(sex: PatientSex): BmiLmsEntry[] {
    return sex === 'male' ? CDC_BMI_LMS_MALE : CDC_BMI_LMS_FEMALE;
}

/**
 * Nội suy tuyến tính L, M, S tại đúng số tháng tuổi (dữ liệu CDC công bố theo từng
 * mốc tháng nguyên), clamp về [24.0, 239.8] tháng — ngoài khoảng này BMI-for-age
 * theo phương pháp CDC không còn hiệu lực.
 */
export function interpolateBmiLms(ageMonths: number, sex: PatientSex): BmiLmsEntry | null {
    if (ageMonths < MIN_AGE_MONTHS || ageMonths > MAX_AGE_MONTHS) return null;

    const table = getLmsTable(sex);
    const clamped = Math.min(Math.max(ageMonths, MIN_AGE_MONTHS), MAX_AGE_MONTHS);

    // table đã sắp xếp tăng dần theo ageMonths, cách nhau ~1 tháng.
    let lower = table[0];
    let upper = table[table.length - 1];
    for (let i = 0; i < table.length - 1; i++) {
        if (table[i].ageMonths <= clamped && clamped <= table[i + 1].ageMonths) {
            lower = table[i];
            upper = table[i + 1];
            break;
        }
    }

    if (lower.ageMonths === upper.ageMonths) return lower;

    const t = (clamped - lower.ageMonths) / (upper.ageMonths - lower.ageMonths);
    return {
        ageMonths: clamped,
        L: lower.L + t * (upper.L - lower.L),
        M: lower.M + t * (upper.M - lower.M),
        S: lower.S + t * (upper.S - lower.S),
    };
}

/** Z-score của một giá trị BMI cho trước, theo LMS: Z = ((X/M)^L - 1)/(L*S), hoặc ln(X/M)/S nếu L=0. */
export function bmiToZScore(bmi: number, lms: BmiLmsEntry): number {
    const { L, M, S } = lms;
    if (L === 0) return Math.log(bmi / M) / S;
    return (Math.pow(bmi / M, L) - 1) / (L * S);
}

/** Nghịch đảo LMS: cho trước Z-score, suy ra giá trị BMI tương ứng. Dùng để dựng khoảng bình thường theo percentile mốc (VD 5th, 85th). */
export function zScoreToBmi(z: number, lms: BmiLmsEntry): number {
    const { L, M, S } = lms;
    if (L === 0) return M * Math.exp(S * z);
    return M * Math.pow(1 + L * S * z, 1 / L);
}

/** Xấp xỉ hàm phân phối chuẩn tích lũy (Zelen & Severo), sai số < 7.5e-8 — đủ chính xác cho mục đích lâm sàng thông thường. */
export function standardNormalCdf(z: number): number {
    const b1 = 0.319381530;
    const b2 = -0.356563782;
    const b3 = 1.781477937;
    const b4 = -1.821255978;
    const b5 = 1.330274429;
    const p = 0.2316419;
    const c = 0.39894228;

    if (z >= 0) {
        const t = 1 / (1 + p * z);
        return 1 - c * Math.exp((-z * z) / 2) * t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1);
    }
    return 1 - standardNormalCdf(-z);
}

/**
 * Z-score ứng với các mốc percentile chuẩn dùng để phân loại BMI-for-age của CDC
 * (giá trị quantile chuẩn của phân phối chuẩn tắc, tra bảng z thông thường).
 */
const Z_AT_5TH_PERCENTILE = -1.6448536;
const Z_AT_85TH_PERCENTILE = 1.0364334;
const Z_AT_95TH_PERCENTILE = 1.6448536;

function classifyByPercentile(percentile: number): PediatricBmiCategory {
    if (percentile < PEDIATRIC_BMI_PERCENTILE_CUTOFF.UNDERWEIGHT_MAX) return 'UNDERWEIGHT';
    if (percentile < PEDIATRIC_BMI_PERCENTILE_CUTOFF.HEALTHY_MAX) return 'HEALTHY';
    if (percentile < PEDIATRIC_BMI_PERCENTILE_CUTOFF.OVERWEIGHT_MAX) return 'OVERWEIGHT';
    return 'OBESE';
}

/**
 * Đánh giá đầy đủ BMI-for-age cho trẻ 2–<20 tuổi: Z-score, percentile và phân loại.
 * Trả về null nếu ngoài khoảng áp dụng (< 2 tuổi hoặc >= 20 tuổi) — nơi gọi nên
 * fallback sang cách xử lý phù hợp (VD dùng ngưỡng BMI người lớn nếu >= 20 tuổi).
 */
export function assessPediatricBmi(
    ageMonths: number,
    sex: PatientSex,
    bmi: number,
): PediatricBmiAssessment | null {
    const lms = interpolateBmiLms(ageMonths, sex);
    if (!lms) return null;

    const zScore = bmiToZScore(bmi, lms);
    const percentile = Math.round(standardNormalCdf(zScore) * 10000) / 100; // %, 2 chữ số thập phân
    return {
        ageMonths,
        sex,
        bmi,
        zScore: Math.round(zScore * 100) / 100,
        percentile,
        category: classifyByPercentile(percentile),
    };
}

/**
 * Khoảng BMI "bình thường" (5th–85th percentile) tại đúng tuổi/giới tính của bệnh
 * nhi — dùng để hiển thị minNormal/maxNormal giống các chỉ số sinh hiệu khác thay
 * vì hiển thị percentile (vốn khó hình dung với điều dưỡng/người nhà hơn là một
 * khoảng số cụ thể).
 */
export function getPediatricBmiNormalRange(
    ageMonths: number,
    sex: PatientSex,
): { minNormal: number; maxNormal: number } | null {
    const lms = interpolateBmiLms(ageMonths, sex);
    if (!lms) return null;

    return {
        minNormal: Math.round(zScoreToBmi(Z_AT_5TH_PERCENTILE, lms) * 100) / 100,
        maxNormal: Math.round(zScoreToBmi(Z_AT_85TH_PERCENTILE, lms) * 100) / 100,
    };
}

/** Ngưỡng BMI người lớn (>=20 tuổi) theo phân loại chuẩn của WHO/CDC, không phụ thuộc tuổi/giới tính. */
export const ADULT_BMI_NORMAL_RANGE = { minNormal: 18.5, maxNormal: 24.9 } as const;

/**
 * Điểm vào chính: trả về khoảng BMI bình thường phù hợp với tuổi của bệnh nhân.
 * - < 24 tháng tuổi: chưa đủ cơ sở áp dụng BMI-for-age (nên dùng weight-for-length) → null.
 * - 24 tháng – <20 tuổi (240 tháng): dùng percentile CDC theo tuổi/giới tính.
 * - >= 20 tuổi: dùng ngưỡng BMI người lớn cố định (18.5–24.9), không phân biệt giới tính/tuổi.
 */
export function getBmiNormalRange(
    ageMonths: number,
    sex: PatientSex | null,
): { minNormal: number; maxNormal: number; sourceReference: string } | null {
    if (ageMonths >= MAX_AGE_MONTHS + 0.2 /* == 240 tháng, mốc 20 tuổi */) {
        return { ...ADULT_BMI_NORMAL_RANGE, sourceReference: 'WHO/CDC – ngưỡng BMI người lớn (18.5–24.9)' };
    }

    if (ageMonths < MIN_AGE_MONTHS) return null; // < 2 tuổi: không áp dụng BMI-for-age

    if (!sex) return null; // cần giới tính để tra bảng LMS theo tuổi/giới

    const range = getPediatricBmiNormalRange(ageMonths, sex);
    if (!range) return null;

    return {
        ...range,
        sourceReference: 'CDC 2000 Growth Charts – BMI-for-age percentile (5th–85th), theo tuổi & giới tính',
    };
}
