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
 * ── Quy ước nguồn cho 27 chỉ số máu (BLOODFULL), kiểm tra lần cuối 26/11/2026 ────────────────────
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
 *  - TTE/CXRPA (kiểm chứng lại 26/11/2026): LVEF theo ESC 2021 HF (>=50 / 41-49 / <=40) + ASE/EACVI 2015 (<30 = severely abnormal);
 *    LVIDd theo ASE/EACVI 2015 (Table 2 + Supplemental Table 3); đường kính nhĩ trái theo ASE 2005 (ASE/EACVI 2015 giữ nguyên giá trị bình thường,
 *    nhưng KHÔNG khuyến nghị ngưỡng phân độ cho đường kính LA và ưu tiên LA volume index); CTR chỉ có ngưỡng >50% (phim PA).
 *    Ngưỡng 'CTR >= 60% tim to rõ' của bản cũ KHÔNG tìm được nguồn nên đã bỏ.
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
    const PED_MIN = 1;
    const PED_MAX = ADULT_MIN - 1; // 17
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
        ESC_HF_2021: 'https://doi.org/10.1093/eurheartj/ehab368',
        ASE_CHAMBER_2015: 'https://doi.org/10.1016/j.echo.2014.10.003',
        EACVI_CHAMBER_2015: 'https://doi.org/10.1093/ehjci/jev014',
        ASE_LA_2005: 'https://www.escardio.org/static-file/Escardio/Subspecialty/EACVI/position-papers/eae-lang-chamber-quantification.pdf',
        CTR_RADIO: 'https://www.radiologymasterclass.co.uk/tutorials/chest/chest_home_anatomy/chest_anatomy_page8',
        CTR_INSIGHTS: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8566609',
        CTR_CMAJ: 'https://www.cmaj.ca/content/193/44/E1683',
    };

    const SRC = {
        // Khoảng bình thường người lớn theo giới của Mayo; mức critical theo danh sách giá trị nguy kịch của OHSU
        CBC_MAYO_CRIT: `Khoảng tham chiếu: Mayo Clinic Laboratories, CBC with Differential, người lớn >=18t (${URL.MAYO_CBC}); giá trị nguy kịch: OHSU Lab Services (${URL.OHSU_CBC})`,
        CBC_MAYO: `Khoảng tham chiếu: Mayo Clinic Laboratories, CBC with Differential, người lớn >=18t (${URL.MAYO_CBC}); không có nguồn giá trị nguy kịch cho chỉ số này`,
        CBC_OHSU: `Khoảng tham chiếu: OHSU Lab Services, CBC with Differential, người lớn >=18t (${URL.OHSU_CBC}); không có nguồn giá trị nguy kịch cho chỉ số này`,
        GLU: `ADA Standards of Care 2026: glucose đói bình thường <100, tiền đái tháo đường 100-125, đái tháo đường >=126 mg/dL (${URL.ADA_DIAG}); hạ đường huyết mức 1 54-69, mức 2 <54 mg/dL (${URL.ADA_HYPO}); giá trị nguy kịch cao >500 mg/dL: UChicago Medicine Labs (${URL.UCHICAGO_BMP})`,
        BMP_MAYO: `Khoảng tham chiếu: Mayo Clinic Laboratories, Basic Metabolic Panel, người lớn (${URL.MAYO_BMP}); không có nguồn giá trị nguy kịch cho chỉ số này`,
        BMP_MAYO_EXT: `Khoảng tham chiếu theo tuổi và giới: Mayo Clinic Laboratories, Basic Metabolic Panel (${URL.MAYO_BMP}); trẻ <1 tuổi "Not established" (ngoài phạm vi, bỏ qua); không có nguồn giá trị nguy kịch cho chỉ số này`,
        ELEC: `Khoảng tham chiếu: Mayo Clinic Laboratories, Basic Metabolic Panel (${URL.MAYO_BMP}); giá trị nguy kịch: UChicago Medicine Labs, Basic Metabolic Panel (${URL.UCHICAGO_BMP})`,
        ATP3: `NCEP ATP III (NHLBI): phân loại cholesterol toàn phần, LDL-C, HDL-C (thấp <40 nam, <50 nữ) và triglyceride (rất cao >=500, nguy cơ viêm tụy) (${URL.ATP3})`,
        TNT: `Khoảng tham chiếu theo giới (nam <=15, nữ <=10 ng/L): Mayo Clinic Laboratories, Troponin T 5th generation (${URL.MAYO_TNT}); ngưỡng rule-in 0h >=52 ng/L cho hs-cTnT Elecsys: ESC 2023 ACS Guidelines (${URL.ESC_ACS_2023})`,
        CKMB: `University of Washington Medicine Laboratory, CK-MB Mass: tham chiếu 0-5 ng/mL, >9 ng/mL phù hợp tổn thương/nhồi máu cơ tim (${URL.UW_CKMB})`,
        NTPB: `Khoảng tham chiếu theo tuổi và giới: Mayo Clinic Laboratories, NT-proBNP (${URL.MAYO_NTPB}); ngưỡng gợi ý suy tim cấp theo tuổi 450 (<50t) / 900 (50-75t) / 1800 (>75t) pg/mL: Mayo, dẫn Januzzi và cs., ICON, Eur Heart J 2006 (${URL.ICON_NTPB})`,
        // ── Nhi 1–17 tuổi ──
        CBC_MAYO_PED: `Khoảng tham chiếu theo tuổi và giới: Mayo Clinic Laboratories, CBC with Differential, trẻ em 1-17t (${URL.MAYO_CBC}); không có nguồn giá trị nguy kịch cho trẻ em`,
        BMP_MAYO_PED: `Khoảng tham chiếu theo tuổi: Mayo Clinic Laboratories, Basic Metabolic Panel, trẻ em 1-17t (${URL.MAYO_BMP}); không có nguồn giá trị nguy kịch cho trẻ em`,
        GLU_PED: `ADA Standards of Care 2026, áp dụng ngưỡng chẩn đoán (${URL.ADA_DIAG}) và hạ đường huyết mức 1/2 (${URL.ADA_HYPO}) cho trẻ 1-17t; Mayo BMP chỉ nêu glucose ngẫu nhiên 70-140 mg/dL (${URL.MAYO_BMP}); cần bác sĩ nhi xác nhận`,
        NTPB_PED: `Khoảng tham chiếu theo tuổi: Mayo Clinic Laboratories, NT-proBNP, trẻ em 1-17t (${URL.MAYO_NTPB}); không có ngưỡng gợi ý suy tim cấp cho trẻ em`,
        // echocardiogram
        // LVEF: `ESC 2021 Heart Failure Guidelines (McDonagh et al., Eur Heart J 2021;42:3599–3726, ${URL.ESC_HF_2021}): HFrEF <=40%, HFmrEF 41-49%, HFpEF >=50%; mức 30-40% (giảm vừa) và <30% (giảm nặng) theo ASE/EACVI 2015 Table 4 (Lang et al., ${URL.ASE_CHAMBER_2015}); cần bác sĩ siêu âm xác nhận. Nếu bệnh nhân bị suy tim, mức >=50% vẫn đại diện cho bị bệnh, không phải là tiêu chí quyết định người bệnh bình thường`,
        // ── Echocardiogram (TTE - ASE/EACVI 2015) ──
        ASE_LVEF: `ASE/EACVI 2015 (Lang et al., J Am Soc Echocardiogr 2015;28:1–39, ${URL.ASE_CHAMBER_2015}; Eur Heart J Cardiovasc Imaging 2015;16:233–71, ${URL.EACVI_CHAMBER_2015}) Table 4: LVEF bình thường theo giới (nam 52–72%, nữ 54–74%), giảm nhẹ 41–51% (nam) / 41–53% (nữ), giảm vừa 30–40%, giảm nặng <30%; lưu ý phân loại suy tim theo ESC 2021 (${URL.ESC_HF_2021}) dùng mốc chung >=50% (HFpEF); cần bác sĩ siêu âm xác nhận`,
        ASE_LVIDD: `ASE/EACVI 2015 (Lang et al., J Am Soc Echocardiogr 2015;28:1–39, ${URL.ASE_CHAMBER_2015}; Eur Heart J Cardiovasc Imaging 2015;16:233–71, ${URL.EACVI_CHAMBER_2015}) Table 2: LVIDd bình thường theo giới (nam 42.0–58.4 mm, nữ 37.8–52.2 mm), mức giãn nhẹ/vừa/nặng theo Supplemental Table 3; cần bác sĩ siêu âm xác nhận`,
        ASE_LA_DIAM: `ASE/EACVI 2015 (${URL.EACVI_CHAMBER_2015}) giữ nguyên ngưỡng đường kính nhĩ trái trước-sau (LA AP) của ASE/EAE 2005 (Lang et al., J Am Soc Echocardiogr 2005;18:1440–63, ${URL.ASE_LA_2005}): bình thường <=40 mm (nam) và <=38 mm (nữ), không chia mức độ giãn; khuyến cáo ưu tiên đánh giá bằng LAVI; cần bác sĩ siêu âm xác nhận`,
        ASE_LAVI: `ASE/EACVI 2015 (Lang et al., J Am Soc Echocardiogr 2015;28:1–39, ${URL.ASE_CHAMBER_2015}; Eur Heart J Cardiovasc Imaging 2015;16:233–71, ${URL.EACVI_CHAMBER_2015}) Table 9 & Supplemental Table 11: chỉ số thể tích nhĩ trái (LAVI) bình thường 16–34 mL/m² (chung hai giới), giãn nhẹ 35–41, vừa 42–48, nặng >48 mL/m²; cần bác sĩ siêu âm xác nhận`,
        ASE_LV_WALL: `ASE/EACVI 2015 (Lang et al., J Am Soc Echocardiogr 2015;28:1–39, ${URL.ASE_CHAMBER_2015}; Eur Heart J Cardiovasc Imaging 2015;16:233–71, ${URL.EACVI_CHAMBER_2015}) Table 3 & Supplemental Table 4: bề dày vách liên thất (IVSd) và thành sau thất trái (LVPWd) bình thường 6–10 mm (nam) / 6–9 mm (nữ), dày nhẹ/vừa/nặng theo giới; cần bác sĩ siêu âm xác nhận`,
        ASE_LVMI: `ASE/EACVI 2015 (Lang et al., J Am Soc Echocardiogr 2015;28:1–39, ${URL.ASE_CHAMBER_2015}; Eur Heart J Cardiovasc Imaging 2015;16:233–71, ${URL.EACVI_CHAMBER_2015}) Table 3 & Supplemental Table 4: chỉ số khối cơ thất trái (LVMI, phương pháp tuyến tính) bình thường 49–115 g/m² (nam) và 43–95 g/m² (nữ), phì đại nhẹ/vừa/nặng theo giới; cần bác sĩ siêu âm xác nhận`,
        ASE_TAPSE: `ASE/EACVI 2015 (Lang et al., J Am Soc Echocardiogr 2015;28:1–39, ${URL.ASE_CHAMBER_2015}; Eur Heart J Cardiovasc Imaging 2015;16:233–71, ${URL.EACVI_CHAMBER_2015}) Table 8 & Supplemental Table 10: biên độ dịch chuyển vòng van ba lá thì tâm thu (TAPSE) bình thường >=17 mm (chung hai giới), <17 mm gợi ý giảm chức năng tâm thu thất phải; cần bác sĩ siêu âm xác nhận`,
        ASE_RVD1: `ASE/EACVI 2015 (Lang et al., J Am Soc Echocardiogr 2015;28:1–39, ${URL.ASE_CHAMBER_2015}; Eur Heart J Cardiovasc Imaging 2015;16:233–71, ${URL.EACVI_CHAMBER_2015}) Table 7 & Supplemental Table 9: đường kính đáy thất phải (RVD1, mặt cắt 4 buồng từ mỏm chuẩn) bình thường 25–41 mm (chung hai giới), >41 mm gợi ý giãn thất phải; cần bác sĩ siêu âm xác nhận`,
        // chest X-ray
        CTR: `X-quang ngực thẳng (PA, đứng) người lớn: CTR > 50% là bất thường (${URL.CTR_RADIO}; GPnotebook, Kelly B. Ulster Med J 2012;81:143–8); mốc >=60% là quy ước thực hành, không phải ngưỡng của hướng dẫn chuẩn; CTR kém đặc hiệu so với MRI tim (Insights Imaging 2021, ${URL.CTR_INSIGHTS}; CMAJ 2021, ${URL.CTR_CMAJ}); cần bác sĩ CĐHA xác nhận`,
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
    const ntProBnpRuleIn = (ageMin: number) => (ageMin < 50 ? 451 : ageMin <= 75 ? 900 : 1800);
    const ntProBnpRows = ntProBnpSegments.flatMap(([ageMin, ageMax, maleLower, femaleLower]) => {
        const rule = ntProBnpRuleIn(ageMin);
        const src = ref(SRC.NTPB, '33762-6');
        return [
            ...build('BLOODFULL', 'NTPROBNP', [['normal', null], ['medium', maleLower], ['high', rule]], { step: 1, gender: 'male', ageMin, ageMax, sourceReference: src }),
            ...build('BLOODFULL', 'NTPROBNP', [['normal', null], ['medium', femaleLower], ['high', rule]], { step: 1, gender: 'female', ageMin, ageMax, sourceReference: src }),
        ];
    });

    // ═════════════ Nhi khoa 1–17 tuổi (Mayo Clinic Laboratories) ═════════════
    // Tuổi nguyên: 1t = 12–23 tháng (dùng dải "6–23 tháng" của Mayo), 2t = 24–35 tháng.
    // Chỉ có low | normal | high (không critical, vì chưa có nguồn nguy kịch cho trẻ em).
    type PedSeg = [number, number, number, number, number, number]; // [ageMin, ageMax, nam lo, nam hi, nữ lo, nữ hi]

    /** Dải low | normal | high theo tuổi và giới; `high` bắt đầu ngay sau cận trên của normal. */
    const pedRange = (code: string, step: number, src: string, segs: PedSeg[]): ThresholdSeed[] =>
        segs.flatMap(([ageMin, ageMax, mLo, mHi, fLo, fHi]) =>
            ([['male', mLo, mHi], ['female', fLo, fHi]] as const).flatMap(([gender, lo, hi]) => {
                const bands: Band[] =
                    lo > 0
                        ? [['low', null], ['normal', lo], ['high', round(hi + step)]]
                        : [['normal', null], ['high', round(hi + step)]];
                return build('BLOODFULL', code, bands, { step, gender, ageMin, ageMax, sourceReference: src });
            }),
        );

    const cbcPed = (code: string, loinc: string, step: number, segs: PedSeg[]) => pedRange(code, step, ref(SRC.CBC_MAYO_PED, loinc), segs);

    // Creatinine (mg/dL): Mayo dùng dải người lớn từ 15t (nam) / 16t (nữ) -> nam 15-17t, nữ 16-17t lấy dải người lớn
    const creaPedSegs: Array<['male' | 'female', number, number, number, number]> = [
        ['male', 1, 5, 0.19, 0.49],
        ['male', 6, 10, 0.26, 0.61],
        ['male', 11, 14, 0.35, 0.86],
        ['male', 15, PED_MAX, 0.74, 1.35],
        ['female', 1, 5, 0.19, 0.49],
        ['female', 6, 10, 0.26, 0.61],
        ['female', 11, 15, 0.35, 0.86],
        ['female', 16, PED_MAX, 0.59, 1.04],
    ];

    // NT-proBNP (pg/mL), Mayo (cả hai giới): 1t 37-646 · 2t 39-413 · 3-6t 23-289 · 7-14t <=157 · 15-17t <=158.
    // Chỉ cảnh báo khi VƯỢT cận trên (cột thứ 3 = giá trị đầu tiên vượt khoảng bình thường).
    const ntProBnpPedSegs: Array<[number, number, number, number]> = [
        [1, 1, 37, 646],
        [2, 2, 39, 413],
        [3, 6, 23, 289],
        [7, 14, 0, 157],
        [15, PED_MAX, 0, 158],
    ];

    const pediatricRows: ThresholdSeed[] = [
        // ── CBC (Mayo) ── [ageMin, ageMax, nam lo, nam hi, nữ lo, nữ hi]
        // RBC (10^12/L)
        ...cbcPed('RBC', '789-8', 0.01, [
            [1, 1, 4.03, 5.07, 3.97, 5.01],
            [2, 2, 3.89, 4.97, 3.84, 4.92],
            [3, 5, 4.0, 5.1, 4.0, 5.1],
            [6, 10, 4.1, 5.2, 4.1, 5.2],
            [11, 14, 4.2, 5.3, 4.1, 5.1],
            [15, 17, 4.3, 5.7, 3.8, 5.0],
        ]),
        // Hemoglobin (g/dL)
        ...cbcPed('HGB', '718-7', 0.1, [
            [1, 1, 10.1, 12.5, 10.2, 12.7],
            [2, 2, 10.2, 12.7, 10.2, 12.7],
            [3, 5, 11.4, 14.3, 11.4, 14.3],
            [6, 8, 11.5, 14.3, 11.5, 14.3],
            [9, 10, 11.8, 14.7, 11.8, 14.7],
            [11, 14, 12.4, 15.7, 11.9, 14.8],
            [15, 17, 13.3, 16.9, 11.9, 14.8],
        ]),
        // Hematocrit (%)
        ...cbcPed('HCT', '4544-3', 0.1, [
            [1, 1, 30.8, 37.8, 30.9, 37.9],
            [2, 2, 31.0, 37.7, 31.2, 37.8],
            [3, 7, 34, 42, 34, 42],
            [8, 11, 35, 43, 35, 43],
            [12, 15, 38, 47, 35, 43],
            [16, 17, 40, 50, 35, 43],
        ]),
        // MCV (fL)
        ...cbcPed('MCV', '787-2', 0.1, [
            [1, 1, 69.5, 81.7, 71.3, 82.6],
            [2, 2, 71.3, 84.0, 72.3, 85.0],
            [3, 5, 77.2, 89.5, 77.2, 89.5],
            [6, 11, 77.8, 91.1, 77.8, 91.1],
            [12, 14, 79.9, 93.0, 79.9, 93.0],
            [15, 17, 82.5, 98.0, 82.5, 98.0],
        ]),
        // RDW (%)
        ...cbcPed('RDW', '788-0', 0.1, [
            [1, 1, 12.9, 15.6, 12.7, 15.1],
            [2, 2, 12.5, 14.9, 12.4, 14.9],
            [3, 5, 11.3, 13.4, 11.3, 13.4],
            [6, 17, 11.4, 13.5, 11.4, 13.5],
        ]),
        // WBC (10^9/L)
        ...cbcPed('WBC', '6690-2', 0.1, [
            [1, 1, 6.0, 13.5, 6.5, 13.0],
            [2, 2, 5.1, 13.4, 4.9, 13.2],
            [3, 5, 4.4, 12.9, 4.4, 12.9],
            [6, 17, 3.8, 10.4, 3.8, 10.4],
        ]),
        // Tiểu cầu (10^9/L)
        ...cbcPed('PLT', '777-3', 1, [
            [1, 1, 206, 445, 214, 459],
            [2, 2, 202, 403, 189, 394],
            [3, 5, 187, 445, 187, 445],
            [6, 9, 187, 400, 187, 400],
            [10, 13, 177, 381, 177, 381],
            [14, 17, 139, 320, 158, 362],
        ]),

        // ── Công thức bạch cầu số tuyệt đối (10^9/L), Mayo ── [ageMin, ageMax, nam lo, nam hi, nữ lo, nữ hi]
        ...cbcPed('NEUT_ABS', '751-8', 0.01, [
            [1, 1, 1.19, 7.21, 1.27, 7.18],
            [2, 2, 1.54, 7.92, 1.60, 8.29],
            [3, 5, 1.60, 7.80, 1.60, 7.80],
            [6, 14, 1.40, 6.10, 1.50, 6.50],
            [15, 16, 1.40, 6.10, 2.00, 7.40],
            [17, 17, 1.80, 7.20, 2.00, 7.40],
        ]),
        ...cbcPed('LYMPH_ABS', '731-0', 0.01, [
            [1, 1, 1.56, 7.83, 1.52, 8.09],
            [2, 2, 1.13, 5.52, 1.25, 5.77],
            [3, 5, 1.60, 5.30, 1.60, 5.30],
            [6, 11, 1.40, 3.90, 1.40, 3.90],
            [12, 17, 1.00, 3.20, 1.00, 3.20],
        ]),
        ...cbcPed('MONO_ABS', '742-7', 0.01, [
            [1, 1, 0.25, 1.15, 0.26, 1.08],
            [2, 2, 0.19, 0.94, 0.24, 0.92],
            [3, 5, 0.30, 0.90, 0.30, 0.90],
            [6, 17, 0.20, 0.80, 0.20, 0.80],
        ]),
        ...cbcPed('EOS_ABS', '711-2', 0.01, [
            [1, 1, 0.02, 0.82, 0.02, 0.58],
            [2, 2, 0.03, 0.53, 0.03, 0.46],
            [3, 11, 0.0, 0.5, 0.0, 0.5],
            [12, 17, 0.1, 0.2, 0.1, 0.2],
        ]),
        ...cbcPed('BASO_ABS', '704-7', 0.01, [
            [1, 2, 0.01, 0.06, 0.01, 0.06],
            [3, 17, 0.0, 0.1, 0.0, 0.1],
        ]),

        // ── Sinh hóa / điện giải (Mayo BMP, cả hai giới 1-17t) ──
        // Na 135-145 mmol/L · K 3.6-5.2 mmol/L · BUN 7-20 mg/dL
        ...build('BLOODFULL', 'NA', [['low', null], ['normal', 135], ['high', 146]], {
            step: 1,
            ageMin: PED_MIN,
            ageMax: PED_MAX,
            sourceReference: ref(SRC.BMP_MAYO_PED, '2951-2'),
        }),
        ...build('BLOODFULL', 'K', [['low', null], ['normal', 3.6], ['high', 5.3]], {
            step: 0.1,
            ageMin: PED_MIN,
            ageMax: PED_MAX,
            sourceReference: ref(SRC.BMP_MAYO_PED, '2823-3'),
        }),
        ...build('BLOODFULL', 'URE', [['low', null], ['normal', 7], ['high', 21]], {
            step: 1,
            ageMin: PED_MIN,
            ageMax: PED_MAX,
            sourceReference: ref(SRC.BMP_MAYO_PED, '3094-0'),
        }),
        ...creaPedSegs.flatMap(([gender, ageMin, ageMax, lo, hi]) =>
            build('BLOODFULL', 'CREA', [['low', null], ['normal', lo], ['high', round(hi + 0.01)]], {
                step: 0.01,
                gender,
                ageMin,
                ageMax,
                sourceReference: ref(SRC.BMP_MAYO_PED, '2160-0'),
            }),
        ),
        // Glucose: ngưỡng ADA như người lớn; bỏ mức critical >500 (nguồn UChicago là của người lớn), giữ critical <54 (ADA mức 2)
        ...build('BLOODFULL', 'GLU', [['critical', null], ['low', 54], ['normal', 70], ['medium', 100], ['high', 126]], {
            step: 1,
            ageMin: PED_MIN,
            ageMax: PED_MAX,
            sourceReference: ref(SRC.GLU_PED, '2345-7'),
        }),

        // ── NT-proBNP (Mayo, cả hai giới) ──
        ...ntProBnpPedSegs.flatMap(([ageMin, ageMax, lo, hi]) =>
            build(
                'BLOODFULL',
                'NTPROBNP',
                lo > 0
                    ? [['low', null], ['normal', lo], ['medium', round(hi + 1)]]
                    : [['normal', null], ['medium', round(hi + 1)]],
                {
                    step: 1,
                    ageMin,
                    ageMax,
                    sourceReference: ref(SRC.NTPB_PED, '33762-6'),
                },
            ),
        ),
    ];

    // ═════════ BMP mở rộng (Mayo BMAMA): Cl, HCO3, Anion gap, Ca, eGFR — trẻ <1 tuổi out-of-scope ═════════
    // Chỉ có low | normal | high (Mayo không có giá trị nguy kịch). Yêu cầu các ResultParameter CL, HCO3, AGAP, CA, EGFR
    // đã tồn tại trong 07-result-parameter (dịch vụ BLOODFULL).
    const bmpExt = (code: string, loinc: string, step: number, segs: PedSeg[]) =>
        pedRange(code, step, ref(SRC.BMP_MAYO_EXT, loinc), segs);

    const bmpExtraRows: ThresholdSeed[] = [
        // Chloride (mmol/L): 1-17t 102-112 · >=18t 98-107 (cả hai giới)
        ...build('BLOODFULL', 'CL', [['low', null], ['normal', 102], ['high', 113]], {
            step: 1, ageMin: PED_MIN, ageMax: PED_MAX, sourceReference: ref(SRC.BMP_MAYO_EXT, '2075-0'),
        }),
        ...build('BLOODFULL', 'CL', [['low', null], ['normal', 98], ['high', 108]], {
            step: 1, ageMin: ADULT_MIN, ageMax: ADULT_MAX, sourceReference: ref(SRC.BMP_MAYO_EXT, '2075-0'),
        }),

        // Bicarbonate (mmol/L), [ageMin, ageMax, nam lo, nam hi, nữ lo, nữ hi]
        // Nam: 1-2t 17-25 · 3t 18-26 · 4-5t 19-27 · 6-7t 20-28 · 8-17t 21-29 · >=18t 22-29
        // Nữ : 1-3t 18-25 · 4-5t 19-26 · 6-7t 20-27 · 8-9t 21-28 · >=10t 22-29
        ...bmpExt('HCO3', '1963-8', 1, [
            [1, 2, 17, 25, 18, 25],
            [3, 3, 18, 26, 18, 25],
            [4, 5, 19, 27, 19, 26],
            [6, 7, 20, 28, 20, 27],
            [8, 9, 21, 29, 21, 28],
            [10, 17, 21, 29, 22, 29],
            [18, ADULT_MAX, 22, 29, 22, 29],
        ]),

        // Anion gap: >=7t 7-15 (<7t Mayo không thiết lập). Là chỉ số tính toán nên dùng step 0.1.
        ...build('BLOODFULL', 'AGAP', [['low', null], ['normal', 7], ['high', 15.1]], {
            step: 0.1, ageMin: 7, ageMax: ADULT_MAX, sourceReference: ref(SRC.BMP_MAYO_EXT, '33037-3'),
        }),

        // Calcium toàn phần (mg/dL), cả hai giới: 1-17t 9.3-10.6 · 18-59t 8.6-10.0 · 60-90t 8.8-10.2 · >90t 8.2-9.6
        ...bmpExt('CA', '17861-6', 0.1, [
            [1, 17, 9.3, 10.6, 9.3, 10.6],
            [18, 59, 8.6, 10.0, 8.6, 10.0],
            [60, 90, 8.8, 10.2, 8.8, 10.2],
            [91, ADULT_MAX, 8.2, 9.6, 8.2, 9.6],
        ]),

        // eGFR (mL/min/1.73m²), CKD-EPI 2021: chỉ người lớn >=18t, bình thường >=60 (Mayo không tính eGFR cho <18t)
        ...build('BLOODFULL', 'EGFR', [['low', null], ['normal', 60]], {
            step: 0.1, ageMin: ADULT_MIN, ageMax: ADULT_MAX, sourceReference: ref(SRC.BMP_MAYO_EXT, '98979-8'),
        }),
    ];



    const thresholds: ThresholdSeed[] = [
        // ═════════════ BLOODFULL — Xét nghiệm máu Full panel (người lớn >=18 tuổi; nhi 1–17 tuổi xem pediatricRows) ═════════════
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

        // ── Nhi khoa 1–17 tuổi: CBC (7 chỉ số), Na, K, BUN, creatinine, glucose, NT-proBNP (theo tuổi và giới) ──
        ...pediatricRows,
        ...bmpExtraRows,

        // ═════════════ Siêu âm tim (TTE) — Chuẩn ASE/EACVI 2015 ═════════════

        // 1. LVEF (%): Nam bình thường 52–72 (giảm nhẹ 41–51) | Nữ bình thường 54–74 (giảm nhẹ 41–53)
        ...build('TTE', 'LVEF', [['critical', 0], ['high', 30], ['medium', 41], ['normal', 52]], { step: 1, gender: 'male', sourceReference: SRC.ASE_LVEF }),
        ...build('TTE', 'LVEF', [['critical', 0], ['high', 30], ['medium', 41], ['normal', 54]], { step: 1, gender: 'female', sourceReference: SRC.ASE_LVEF }),

        // 2. LVIDd (mm): Nam 42.0–58.4 (nhẹ 58.5–63.9, vừa 64.0–68.0, nặng >68.0) | Nữ 37.8–52.2 (nhẹ 52.3–56.9, vừa 57.0–61.0, nặng >61.0)
        ...build('TTE', 'LVIDD', [['normal', 42.0], ['medium', 58.5], ['high', 64.0], ['critical', 68.1]], { step: 0.1, gender: 'male', sourceReference: SRC.ASE_LVIDD }),
        ...build('TTE', 'LVIDD', [['normal', 37.8], ['medium', 52.3], ['high', 57.0], ['critical', 61.1]], { step: 0.1, gender: 'female', sourceReference: SRC.ASE_LVIDD }),

        // 3. Đường kính nhĩ trái (LA AP diameter - mm): Nam 30–40 | Nữ 27–38 (ASE chỉ quy định ngưỡng trên bình thường)
        ...build('TTE', 'LA_DIAM', [['normal', 30], ['medium', 40.1]], { step: 0.1, gender: 'male', sourceReference: SRC.ASE_LA_DIAM }),
        ...build('TTE', 'LA_DIAM', [['normal', 27], ['medium', 38.1]], { step: 0.1, gender: 'female', sourceReference: SRC.ASE_LA_DIAM }),

        // 4. Chỉ số thể tích nhĩ trái (LAVI - mL/m²): Chuẩn vàng đánh giá giãn nhĩ trái (chung cả 2 giới)
        ...build('TTE', 'LAVI', [['normal', 16], ['medium', 35], ['high', 42], ['critical', 48.1]], { step: 0.1, gender: 'male', sourceReference: SRC.ASE_LAVI }),
        ...build('TTE', 'LAVI', [['normal', 16], ['medium', 35], ['high', 42], ['critical', 48.1]], { step: 0.1, gender: 'female', sourceReference: SRC.ASE_LAVI }),

        // 5. Bề dày vách liên thất & thành sau thất trái (IVSd / LVPWd - mm)
        ...build('TTE', 'IVSD', [['normal', 6], ['medium', 11], ['high', 14], ['critical', 16.1]], { step: 0.1, gender: 'male', sourceReference: SRC.ASE_LV_WALL }),
        ...build('TTE', 'IVSD', [['normal', 6], ['medium', 10], ['high', 13], ['critical', 15.1]], { step: 0.1, gender: 'female', sourceReference: SRC.ASE_LV_WALL }),

        // 6. Chỉ số khối cơ thất trái (LVMI - g/m² - phương pháp tuyến tính)
        ...build('TTE', 'LVMI', [['normal', 49], ['medium', 116], ['high', 132], ['critical', 148.1]], { step: 0.1, gender: 'male', sourceReference: SRC.ASE_LVMI }),
        ...build('TTE', 'LVMI', [['normal', 43], ['medium', 96], ['high', 109], ['critical', 121.1]], { step: 0.1, gender: 'female', sourceReference: SRC.ASE_LVMI }),

        // 7. Thất phải (RV): TAPSE (mm) & Đường kính đáy thất phải RVD1 (mm)
        ...build('TTE', 'TAPSE', [['high', 0], ['normal', 17]], { step: 0.1, gender: 'male', sourceReference: SRC.ASE_TAPSE }),
        ...build('TTE', 'TAPSE', [['high', 0], ['normal', 17]], { step: 0.1, gender: 'female', sourceReference: SRC.ASE_TAPSE }),
        ...build('TTE', 'RVD1', [['normal', 25], ['medium', 41.1]], { step: 0.1, gender: 'male', sourceReference: SRC.ASE_RVD1 }),
        ...build('TTE', 'RVD1', [['normal', 25], ['medium', 41.1]], { step: 0.1, gender: 'female', sourceReference: SRC.ASE_RVD1 }),

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