import { PrismaService } from 'prisma/prisma.service';

/**
 * Ngưỡng cảnh báo rule-based (ResultParameterThreshold) cho xét nghiệm máu (dịch vụ 'BLOODFULL', 27 chỉ số — mọi chỉ số đều có ngưỡng) VÀ các chỉ số số học của siêu âm tim / X-quang
 * ngực (LVEF, LVIDd, đường kính nhĩ trái, CTR). Boolean của echo/X-quang không cần ngưỡng (true = bất thường);
 * enum không được tự đánh giá.
 *
 * Lưu ý riêng cho LVEF/LVIDd/LA/CTR: `riskLevel` được dùng như THANG MỨC ĐỘ NGHIÊM TRỌNG (medium < high < critical),
 * KHÔNG theo quy ước "low = thấp hơn bình thường" của xét nghiệm máu — vì với LVEF chính giá trị THẤP mới là nguy hiểm.
 * Đây là dữ liệu mà RuleBasedLabDetector (src/modules/lab-test/lab-anomaly/detectors/rule-based.detector.ts) và
 * ResultThresholdResolver đọc để sinh ResultValueAlert.
 *
 * ── Cách detector đọc ngưỡng (quyết định cách viết seed này) ─────────────────────────────────────
 *  - Mỗi tham số có NHIỀU dòng, mỗi dòng 1 riskLevel: normal | low | medium | high | critical.
 *  - Detector dùng `rows.find(...)` lấy dòng ĐẦU TIÊN có rangeMin <= value <= rangeMax (cả 2 đầu đều inclusive).
 *    => các dải KHÔNG được chồng nhau (nếu chồng, kết quả phụ thuộc thứ tự trả về của DB), và KHÔNG được để hở
 *    (giá trị rơi vào khe hở sẽ bị coi là "không bất thường" mà không báo gì).
 *    Vì vậy mỗi dải được SINH TỰ ĐỘNG từ danh sách "cận dưới": rangeMax = cận dưới của dải kế tiếp − step.
 *  - `normal` là dòng duy nhất không tạo cảnh báo; expectedMin/expectedMax trên alert lấy từ dòng `normal`.
 *  - Quy ước riskLevel (giữ như seed cũ): `low` = thấp hơn khoảng bình thường; `medium`/`high` = cao hơn mức bình
 *    thường theo mức độ; `critical` = giá trị nguy kịch ở cả hai đầu.
 *  - gender: 'male' | 'female' | null (khớp Patient.gender). Dòng đúng giới được ưu tiên hơn dòng gender = null.
 *
 * ── Quy ước nguồn cho 27 chỉ số máu (BLOODFULL), kiểm tra lần cuối 21/11/2026 ────────────────────
 *  - Mọi chỉ số máu đều có dòng `normal`; mỗi dòng có `sourceReference` chứa URL trực tiếp tới tài liệu gốc (xem hằng SRC) và
 *    liên kết LOINC.org của chính chỉ số đó. Cuối hàm có bước tự kiểm tra: thiếu ngưỡng hoặc thiếu URL thì seed báo lỗi.
 *  - Khoảng bình thường: danh mục xét nghiệm chính thức của Mayo Clinic Laboratories và OHSU Lab Services (khoảng tham chiếu
 *    người lớn), hướng dẫn ADA 2026 (glucose), NCEP ATP III của NHLBI (mỡ máu), ESC 2023 (hs-cTnT).
 *  - Mức `critical` CHỈ được đặt khi có nguồn nêu rõ giá trị nguy kịch/ngưỡng quyết định: Hgb, Hct, WBC, PLT (OHSU), Na, K,
 *    glucose cao (UChicago Medicine Labs), glucose thấp (ADA mức 2), TG >= 500 (ATP III), hs-cTnT >= 52 (ESC 2023), CK-MB > 9 (UW Medicine).
 *    Các chỉ số không tìm được nguồn nguy kịch (RBC, MCV, MCH, MCHC, RDW, công thức bạch cầu %, MPV, BUN, creatinine, TC, LDL-C,
 *    HDL-C) chỉ có dải low/normal/high; KHÔNG bịa mức critical.
 *  - Ngưỡng của phòng xét nghiệm phụ thuộc analyzer/quần thể. Đây là ngưỡng tham chiếu để khởi tạo; phòng Lab của cơ sở phải
 *    xác nhận hoặc thay bằng khoảng tham chiếu đã verify tại chỗ (CLSI EP28) trước khi dùng thật.
 *  - Phần Siêu âm tim (TTE) và X-quang ngực (CXRPA) ở cuối file KHÔNG được kiểm chứng lại trong lần cập nhật này.
 *
 * Phụ thuộc ResultParameter (07-result-parameter.seed.ts) — seed này chạy SAU (tiền tố "20-").
 */
export async function seedResultParameterThresholds(prisma: PrismaService): Promise<void> {
    type RiskLevel = 'normal' | 'low' | 'medium' | 'high' | 'critical';
    type Band = [RiskLevel, number | null]; // [riskLevel, cận dưới]; sắp tăng dần; dải đầu tiên cận dưới = null

    interface ThresholdSeed {
        serviceCode: string;
        parameterCode: string;
        ageMin: number;
        ageMax: number;
        gender: 'male' | 'female' | null;
        riskLevel: RiskLevel;
        rangeMin: number | null;
        rangeMax: number | null;
        sourceReference: string;
    }

    const ADULT_MIN = 18;
    const ADULT_MAX = 120;
    const effectiveFrom = new Date('2026-01-01');

    // ── Nguồn trích dẫn (URL trực tiếp). Mỗi sourceReference của chỉ số máu = nguồn ngưỡng + liên kết LOINC.org ──
    const URL = {
        MAYO_CBC: 'https://www.mayocliniclabs.com/test-catalog/overview/9109',
        OHSU_CBC: 'https://www.ohsu.edu/lab-services/cbc-differential',
        MAYO_BMP: 'https://www.mayocliniclabs.com/test-catalog/overview/113630',
        UCHICAGO_BMP: 'https://uchicagomedlabs.testcatalog.org/show/KPNL-1',
        ADA_DIAG: 'https://doi.org/10.2337/dc26-S002',
        ADA_HYPO: 'https://doi.org/10.2337/dc26-S006',
        ATP3: 'https://webarchive.library.unt.edu/eot2008/20080917120359/http://www.nhlbi.nih.gov/guidelines/cholesterol/atglance.htm',
        MAYO_TNT: 'https://www.mayocliniclabs.com/test-catalog/overview/65832',
        ESC_ACS_2023: 'https://doi.org/10.1093/eurheartj/ehad191',
        UW_CKMB: 'https://testguide.labmed.uw.edu/view/MBMASS?tabs=yes',
        MAYO_NTPB: 'https://www.mayocliniclabs.com/test-catalog/overview/615897',
        ICON_NTPB: 'https://doi.org/10.1093/eurheartj/ehi631',
    };

    const SRC = {
        // Khoảng bình thường người lớn theo giới của Mayo; mức critical theo danh sách giá trị nguy kịch của OHSU
        CBC_MAYO_CRIT: `Khoảng tham chiếu: Mayo Clinic Laboratories, CBC with Differential, người lớn >=18t (${URL.MAYO_CBC}); giá trị nguy kịch: OHSU Lab Services (${URL.OHSU_CBC})`,
        CBC_MAYO: `Khoảng tham chiếu: Mayo Clinic Laboratories, CBC with Differential, người lớn >=18t (${URL.MAYO_CBC}); không có nguồn giá trị nguy kịch cho chỉ số này`,
        CBC_OHSU: `Khoảng tham chiếu: OHSU Lab Services, CBC with Differential, người lớn >=18t (${URL.OHSU_CBC}); không có nguồn giá trị nguy kịch cho chỉ số này`,
        GLU: `ADA Standards of Care 2026: glucose đói bình thường <100, tiền đái tháo đường 100-125, đái tháo đường >=126 mg/dL (${URL.ADA_DIAG}); hạ đường huyết mức 1 54-69, mức 2 <54 mg/dL (${URL.ADA_HYPO}); giá trị nguy kịch cao >500 mg/dL: UChicago Medicine Labs (${URL.UCHICAGO_BMP})`,
        BMP_MAYO: `Khoảng tham chiếu: Mayo Clinic Laboratories, Basic Metabolic Panel, người lớn (${URL.MAYO_BMP}); không có nguồn giá trị nguy kịch cho chỉ số này`,
        ELEC: `Khoảng tham chiếu: Mayo Clinic Laboratories, Basic Metabolic Panel (${URL.MAYO_BMP}); giá trị nguy kịch: UChicago Medicine Labs, Basic Metabolic Panel (${URL.UCHICAGO_BMP})`,
        ATP3: `NCEP ATP III (NHLBI): phân loại cholesterol toàn phần, LDL-C, HDL-C (thấp <40 nam, <50 nữ) và triglyceride (rất cao >=500, nguy cơ viêm tụy) (${URL.ATP3})`,
        TNT: `Khoảng tham chiếu theo giới (nam <=15, nữ <=10 ng/L): Mayo Clinic Laboratories, Troponin T 5th generation (${URL.MAYO_TNT}); ngưỡng rule-in 0h >=52 ng/L cho hs-cTnT Elecsys: ESC 2023 ACS Guidelines (${URL.ESC_ACS_2023})`,
        CKMB: `University of Washington Medicine Laboratory, CK-MB Mass: tham chiếu 0-5 ng/mL, >9 ng/mL phù hợp tổn thương/nhồi máu cơ tim (${URL.UW_CKMB})`,
        NTPB: `Khoảng tham chiếu theo tuổi và giới: Mayo Clinic Laboratories, NT-proBNP (${URL.MAYO_NTPB}); ngưỡng gợi ý suy tim cấp theo tuổi 450 (<50t) / 900 (50-75t) / 1800 (>75t) pg/mL: Mayo, dẫn Januzzi và cs., ICON, Eur Heart J 2006 (${URL.ICON_NTPB})`,
        LVEF: 'ESC 2021 Heart Failure Guidelines — phân loại LVEF: ≥50% bảo tồn · 41–49% giảm nhẹ · ≤40% giảm; <30% giảm nặng (ngưỡng nguy kịch theo thực hành lâm sàng, cần bác sĩ siêu âm xác nhận)',
        ASE: 'ASE/EACVI Recommendations for Cardiac Chamber Quantification in Adults (Lang et al., 2015) — giới hạn bình thường & mức giãn theo giới (cần bác sĩ siêu âm xác nhận)',
        CTR: 'X-quang ngực thẳng (PA) người lớn: CTR > 50% gợi ý tim to; > 60% tim to rõ (ngưỡng thực hành thường quy, cần bác sĩ CĐHA xác nhận)',
    };

    /** Gắn liên kết LOINC.org của chính chỉ số vào sourceReference. */
    const ref = (threshold: string, loinc: string) => `${threshold} | LOINC: https://loinc.org/${loinc}`;

    /** Làm tròn để tránh nhiễu số thực (vd 4.7 - 0.01 = 4.6899999...). */
    const round = (n: number) => Math.round(n * 10000) / 10000;

    /** Sinh các dòng ngưỡng liền kề, không chồng, không hở, từ danh sách cận dưới. */
    const build = (
        serviceCode: string,
        parameterCode: string,
        bands: Band[],
        opts: {
            step: number;
            sourceReference: string;
            gender?: 'male' | 'female' | null;
            ageMin?: number;
            ageMax?: number;
        },
    ): ThresholdSeed[] =>
        bands.map(([riskLevel, lower], i) => {
            const nextLower = bands[i + 1]?.[1] ?? null;
            return {
                serviceCode,
                parameterCode,
                ageMin: opts.ageMin ?? ADULT_MIN,
                ageMax: opts.ageMax ?? ADULT_MAX,
                gender: opts.gender ?? null,
                riskLevel,
                rangeMin: lower,
                rangeMax: nextLower === null ? null : round(nextLower - opts.step),
                sourceReference: opts.sourceReference,
            };
        });

    // NT-proBNP (pg/mL): ngưỡng trên bình thường theo tuổi và giới của Mayo; từ ngưỡng gợi ý suy tim cấp theo tuổi trở lên = high.
    // Mayo: 18t (15-18t) <=158 cả hai giới; 19-39t nam <79 / nữ <160; 40-44t nam <=72 / nữ <=162; 45-54t nam <=87 / nữ <=141;
    // 55-64t nam <=88 / nữ <=226; >=65t cả hai giới <=540. Cột thứ 3 = giá trị đầu tiên VƯỢT khoảng bình thường (step 1 pg/mL).
    const ntProBnpSegments: Array<[number, number, number, number]> = [
        // [ageMin, ageMax, nam: cận dưới 'medium', nữ: cận dưới 'medium']
        [18, 18, 159, 159],
        [19, 39, 79, 160],
        [40, 44, 73, 163],
        [45, 49, 88, 142],
        [50, 54, 88, 142],
        [55, 64, 89, 227],
        [65, 75, 541, 541],
        [76, ADULT_MAX, 541, 541],
    ];
    const ntProBnpRuleIn = (ageMin: number) => (ageMin < 50 ? 450 : ageMin <= 75 ? 900 : 1800);
    const ntProBnpRows = ntProBnpSegments.flatMap(([ageMin, ageMax, maleLower, femaleLower]) => {
        const rule = ntProBnpRuleIn(ageMin);
        const src = ref(SRC.NTPB, '33762-6');
        return [
            ...build('BLOODFULL', 'NTPROBNP', [['normal', null], ['medium', maleLower], ['high', rule]], { step: 1, gender: 'male', ageMin, ageMax, sourceReference: src }),
            ...build('BLOODFULL', 'NTPROBNP', [['normal', null], ['medium', femaleLower], ['high', rule]], { step: 1, gender: 'female', ageMin, ageMax, sourceReference: src }),
        ];
    });

    const thresholds: ThresholdSeed[] = [
        // ═════════════ BLOODFULL — Xét nghiệm máu Full panel (người lớn >=18 tuổi) ═════════════
        // Tất cả tham số máu nằm dưới 1 dịch vụ duy nhất; khe giữa các dải = `step` của analyzer (nhập số lẻ mịn hơn step có thể
        // rơi vào khe và không bị gắn cờ -> nên giới hạn số chữ số thập phân khi nhập).
        //
        // ── CBC (15 chỉ số) ──
        // Hemoglobin (g/dL): Mayo nam 13.2-16.6 · nữ 11.6-15.0; nguy kịch OHSU <6.6 / >20.0
        ...build('BLOODFULL', 'HGB', [['critical', null], ['low', 6.6], ['normal', 13.2], ['high', 16.7], ['critical', 20.1]], { step: 0.1, gender: 'male', sourceReference: ref(SRC.CBC_MAYO_CRIT, '718-7') }),
        ...build('BLOODFULL', 'HGB', [['critical', null], ['low', 6.6], ['normal', 11.6], ['high', 15.1], ['critical', 20.1]], { step: 0.1, gender: 'female', sourceReference: ref(SRC.CBC_MAYO_CRIT, '718-7') }),
        // RBC (10^12/L): Mayo nam 4.35-5.65 · nữ 3.92-5.13
        ...build('BLOODFULL', 'RBC', [['low', null], ['normal', 4.35], ['high', 5.66]], { step: 0.01, gender: 'male', sourceReference: ref(SRC.CBC_MAYO, '789-8') }),
        ...build('BLOODFULL', 'RBC', [['low', null], ['normal', 3.92], ['high', 5.14]], { step: 0.01, gender: 'female', sourceReference: ref(SRC.CBC_MAYO, '789-8') }),
        // Hematocrit (%): Mayo nam 38.3-48.6 · nữ 35.5-44.9; nguy kịch OHSU <19.8 / >60.0
        ...build('BLOODFULL', 'HCT', [['critical', null], ['low', 19.8], ['normal', 38.3], ['high', 48.7], ['critical', 60.1]], { step: 0.1, gender: 'male', sourceReference: ref(SRC.CBC_MAYO_CRIT, '4544-3') }),
        ...build('BLOODFULL', 'HCT', [['critical', null], ['low', 19.8], ['normal', 35.5], ['high', 45.0], ['critical', 60.1]], { step: 0.1, gender: 'female', sourceReference: ref(SRC.CBC_MAYO_CRIT, '4544-3') }),
        // MCV (fL): Mayo 78.2-97.9
        ...build('BLOODFULL', 'MCV', [['low', null], ['normal', 78.2], ['high', 98.0]], { step: 0.1, sourceReference: ref(SRC.CBC_MAYO, '787-2') }),
        // MCH (pg) OHSU 27-34 · MCHC (g/dL) OHSU 32-36
        ...build('BLOODFULL', 'MCH', [['low', null], ['normal', 27.0], ['high', 34.1]], { step: 0.1, sourceReference: ref(SRC.CBC_OHSU, '785-6') }),
        ...build('BLOODFULL', 'MCHC', [['low', null], ['normal', 32.0], ['high', 36.1]], { step: 0.1, sourceReference: ref(SRC.CBC_OHSU, '786-4') }),
        // RDW (%): Mayo nam 11.8-14.5 · nữ 12.2-16.1
        ...build('BLOODFULL', 'RDW', [['low', null], ['normal', 11.8], ['high', 14.6]], { step: 0.1, gender: 'male', sourceReference: ref(SRC.CBC_MAYO, '788-0') }),
        ...build('BLOODFULL', 'RDW', [['low', null], ['normal', 12.2], ['high', 16.2]], { step: 0.1, gender: 'female', sourceReference: ref(SRC.CBC_MAYO, '788-0') }),
        // WBC (10^9/L): Mayo 3.4-9.6; nguy kịch OHSU <2.0 / >40.0
        ...build('BLOODFULL', 'WBC', [['critical', null], ['low', 2.0], ['normal', 3.4], ['high', 9.7], ['critical', 40.1]], { step: 0.1, sourceReference: ref(SRC.CBC_MAYO_CRIT, '6690-2') }),
        // Công thức bạch cầu (%), OHSU người lớn: NEUT 50-70 · LYMPH 18-42 · MONO 3.5-9.0 · EOS 1-3 · BASO 0-2
        ...build('BLOODFULL', 'NEUT', [['low', null], ['normal', 50.0], ['high', 70.1]], { step: 0.1, sourceReference: ref(SRC.CBC_OHSU, '770-8') }),
        ...build('BLOODFULL', 'LYMPH', [['low', null], ['normal', 18.0], ['high', 42.1]], { step: 0.1, sourceReference: ref(SRC.CBC_OHSU, '736-9') }),
        ...build('BLOODFULL', 'MONO', [['low', null], ['normal', 3.5], ['high', 9.1]], { step: 0.1, sourceReference: ref(SRC.CBC_OHSU, '5905-5') }),
        ...build('BLOODFULL', 'EOS', [['low', null], ['normal', 1.0], ['high', 3.1]], { step: 0.1, sourceReference: ref(SRC.CBC_OHSU, '713-8') }),
        ...build('BLOODFULL', 'BASO', [['normal', null], ['high', 2.1]], { step: 0.1, sourceReference: ref(SRC.CBC_OHSU, '706-2') }),
        // Tiểu cầu (10^9/L): Mayo nam 135-317 · nữ 157-371; nguy kịch OHSU <=10 / >=1000
        ...build('BLOODFULL', 'PLT', [['critical', null], ['low', 11], ['normal', 135], ['high', 318], ['critical', 1000]], { step: 1, gender: 'male', sourceReference: ref(SRC.CBC_MAYO_CRIT, '777-3') }),
        ...build('BLOODFULL', 'PLT', [['critical', null], ['low', 11], ['normal', 157], ['high', 372], ['critical', 1000]], { step: 1, gender: 'female', sourceReference: ref(SRC.CBC_MAYO_CRIT, '777-3') }),
        // MPV (fL): OHSU 7.2-12.3
        ...build('BLOODFULL', 'MPV', [['low', null], ['normal', 7.2], ['high', 12.4]], { step: 0.1, sourceReference: ref(SRC.CBC_OHSU, '32623-1') }),

        // ── Sinh hóa cơ bản (mg/dL) ──
        // Glucose đói (ADA 2026): nguy kịch <54 (hạ đường huyết mức 2) · low 54-69 (mức 1) · normal 70-99 · medium 100-125 (tiền ĐTĐ)
        //   · high 126-500 (ngưỡng ĐTĐ) · nguy kịch >500 (UChicago Medicine Labs)
        ...build('BLOODFULL', 'GLU', [['critical', null], ['low', 54], ['normal', 70], ['medium', 100], ['high', 126], ['critical', 501]], { step: 1, sourceReference: ref(SRC.GLU, '2345-7') }),
        // Urea nitrogen / BUN (mg/dL): Mayo nam 8-24 · nữ 6-21
        ...build('BLOODFULL', 'URE', [['low', null], ['normal', 8], ['high', 25]], { step: 1, gender: 'male', sourceReference: ref(SRC.BMP_MAYO, '3094-0') }),
        ...build('BLOODFULL', 'URE', [['low', null], ['normal', 6], ['high', 22]], { step: 1, gender: 'female', sourceReference: ref(SRC.BMP_MAYO, '3094-0') }),
        // Creatinine (mg/dL): Mayo nam 0.74-1.35 · nữ 0.59-1.04
        ...build('BLOODFULL', 'CREA', [['low', null], ['normal', 0.74], ['high', 1.36]], { step: 0.01, gender: 'male', sourceReference: ref(SRC.BMP_MAYO, '2160-0') }),
        ...build('BLOODFULL', 'CREA', [['low', null], ['normal', 0.59], ['high', 1.05]], { step: 0.01, gender: 'female', sourceReference: ref(SRC.BMP_MAYO, '2160-0') }),

        // ── Điện giải đồ (mmol/L) ──
        // Na+: Mayo 135-145; nguy kịch UChicago <120 / >160
        ...build('BLOODFULL', 'NA', [['critical', null], ['low', 120], ['normal', 135], ['high', 146], ['critical', 161]], { step: 1, sourceReference: ref(SRC.ELEC, '2951-2') }),
        // K+: Mayo 3.6-5.2; nguy kịch UChicago <2.8 / >=6.0
        ...build('BLOODFULL', 'K', [['critical', null], ['low', 2.8], ['normal', 3.6], ['high', 5.3], ['critical', 6.0]], { step: 0.1, sourceReference: ref(SRC.ELEC, '2823-3') }),

        // ── Bộ mỡ máu (mg/dL), NCEP ATP III ──
        // Total Cholesterol: <200 mong muốn · 200-239 giáp ranh · >=240 cao
        ...build('BLOODFULL', 'TC', [['normal', null], ['medium', 200], ['high', 240]], { step: 1, sourceReference: ref(SRC.ATP3, '2093-3') }),
        // LDL-C: <130 (tối ưu + gần tối ưu) · 130-159 giáp ranh · >=160 cao (gồm cả >=190 rất cao, không tách critical vì ATP III không gọi là nguy kịch)
        ...build('BLOODFULL', 'LDLC', [['normal', null], ['medium', 130], ['high', 160]], { step: 1, sourceReference: ref(SRC.ATP3, '13457-7') }),
        // HDL-C: thấp <40 (nam), <50 (nữ)
        ...build('BLOODFULL', 'HDLC', [['low', null], ['normal', 40]], { step: 1, gender: 'male', sourceReference: ref(SRC.ATP3, '2085-9') }),
        ...build('BLOODFULL', 'HDLC', [['low', null], ['normal', 50]], { step: 1, gender: 'female', sourceReference: ref(SRC.ATP3, '2085-9') }),
        // Triglyceride: <150 · 150-199 giáp ranh · 200-499 cao · >=500 rất cao (nguy cơ viêm tụy)
        ...build('BLOODFULL', 'TG', [['normal', null], ['medium', 150], ['high', 200], ['critical', 500]], { step: 1, sourceReference: ref(SRC.ATP3, '2571-8') }),

        // ── Dấu ấn tim mạch ──
        // hs-Troponin T (ng/L), theo giới (Mayo): nữ <=10 · nam <=15; high tới 51; critical >=52 (ESC 2023 rule-in 0h, Elecsys)
        ...build('BLOODFULL', 'HSTNT', [['normal', null], ['high', 11], ['critical', 52]], { step: 1, gender: 'female', sourceReference: ref(SRC.TNT, '67151-1') }),
        ...build('BLOODFULL', 'HSTNT', [['normal', null], ['high', 16], ['critical', 52]], { step: 1, gender: 'male', sourceReference: ref(SRC.TNT, '67151-1') }),
        // CK-MB mass (ng/mL): 0-5 normal · 5.1-9 high · >9 critical (UW Medicine). Chỉ bổ trợ; ESC khuyến cáo hs-cTn.
        ...build('BLOODFULL', 'CKMB', [['normal', null], ['high', 5.1], ['critical', 9.1]], { step: 0.1, sourceReference: ref(SRC.CKMB, '13969-1') }),
        // NT-proBNP (pg/mL): sinh từ ntProBnpSegments (theo tuổi và giới)
        ...ntProBnpRows,

        // ═════════════ Siêu âm tim (TTE) ═════════════
        // LVEF (%): <30 giảm nặng · 30–40 giảm · 41–49 giảm nhẹ · ≥50 bảo tồn. LƯU Ý: khe giữa các dải = 0.1 -> nhập tối đa 1 chữ số thập phân.
        ...build('TTE', 'LVEF', [['critical', null], ['high', 30], ['medium', 40.1], ['normal', 50]], { step: 0.1, sourceReference: SRC.LVEF }),
        // LVIDd (mm) — ASE 2015: nam 42.0–58.4 · nữ 37.8–52.2; giãn nhẹ → vừa/nặng
        ...build('TTE', 'LVIDD', [['normal', null], ['medium', 58.5], ['high', 64]], { step: 0.1, gender: 'male', sourceReference: SRC.ASE }),
        ...build('TTE', 'LVIDD', [['normal', null], ['medium', 52.3], ['high', 57]], { step: 0.1, gender: 'female', sourceReference: SRC.ASE }),
        // Đường kính nhĩ trái (mm) — ASE 2015: nam 30–40 · nữ 27–38; giãn nhẹ → vừa/nặng
        ...build('TTE', 'LA_DIAM', [['normal', null], ['medium', 40.1], ['high', 47]], { step: 0.1, gender: 'male', sourceReference: SRC.ASE }),
        ...build('TTE', 'LA_DIAM', [['normal', null], ['medium', 38.1], ['high', 43]], { step: 0.1, gender: 'female', sourceReference: SRC.ASE }),

        // ═════════════ X-quang ngực thẳng (CXRPA) ═════════════
        // CTR (%): ≤49.9 bình thường · 50–59.9 tim to · ≥60 tim to rõ
        ...build('CXRPA', 'CTR', [['normal', null], ['medium', 50], ['high', 60]], { step: 0.1, sourceReference: SRC.CTR }),
    ];

    // ── Tra parameterId theo CẶP (serviceCode, parameterCode) — không bao giờ chỉ theo parameterCode ──
    const parameters = await prisma.resultParameter.findMany({ include: { service: true } });
    const paramMap = new Map(parameters.map((p) => [`${p.service.serviceCode}:${p.parameterCode}`, p.parameterId]));

    const getParameterId = (serviceCode: string, parameterCode: string): string => {
        const id = paramMap.get(`${serviceCode}:${parameterCode}`);
        if (!id) {
            throw new Error(
                `Không tìm thấy ResultParameter '${parameterCode}' của dịch vụ '${serviceCode}' — kiểm tra 06-service-catalog và 07-result-parameter đã chạy trước và mã khớp nhau.`,
            );
        }
        return id;
    };

    // Resolve hết trước khi ghi DB: nếu thiếu tham số thì lỗi ngay, không để seed "thành công" mà thiếu ngưỡng.
    const rows = thresholds.map((t) => ({ ...t, parameterId: getParameterId(t.serviceCode, t.parameterCode) }));

    // ── Tự kiểm tra: mọi tham số của BLOODFULL phải có ngưỡng `normal` và mọi dòng máu phải có URL nguồn ──
    const bloodParamCodes = parameters.filter((p) => p.service.serviceCode === 'BLOODFULL' && p.isActive).map((p) => p.parameterCode);
    const bloodRows = rows.filter((r) => r.serviceCode === 'BLOODFULL');
    const missingNormal = bloodParamCodes.filter((code) => !bloodRows.some((r) => r.parameterCode === code && r.riskLevel === 'normal'));
    if (missingNormal.length > 0) {
        throw new Error(`BLOODFULL thiếu ngưỡng (dòng normal) cho: ${missingNormal.join(', ')}`);
    }
    const missingUrl = bloodRows.filter((r) => !/https?:\/\//.test(r.sourceReference));
    if (missingUrl.length > 0) {
        throw new Error(`Có ${missingUrl.length} dòng ngưỡng máu thiếu URL nguồn trích dẫn`);
    }

    // Làm mới toàn bộ ngưỡng. ResultValueAlert.thresholdId là FK (không cascade) nên KHÔNG xóa được dòng ngưỡng đã
    // có cảnh báo tham chiếu -> các dòng đó chỉ bị vô hiệu hóa (isActive = false) để giữ lịch sử, dòng còn lại bị xóa.
    await prisma.resultParameterThreshold.deleteMany({ where: { alerts: { none: {} } } });
    await prisma.resultParameterThreshold.updateMany({ where: { isActive: true }, data: { isActive: false } });

    await prisma.resultParameterThreshold.createMany({
        data: rows.map((t) => ({
            parameterId: t.parameterId,
            ageMin: t.ageMin,
            ageMax: t.ageMax,
            gender: t.gender,
            riskLevel: t.riskLevel,
            rangeMin: t.rangeMin,
            rangeMax: t.rangeMax,
            isActive: true,
            effectiveFrom,
            sourceReference: t.sourceReference,
        })),
    });

    const count = await prisma.resultParameterThreshold.count({ where: { isActive: true } });
    console.log(`Seeded ${rows.length} result parameter thresholds (BLOODFULL + echo + xray), active in DB: ${count}`);
}
