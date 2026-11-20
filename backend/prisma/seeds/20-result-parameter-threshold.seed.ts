import { PrismaService } from 'prisma/prisma.service';

/**
<<<<<<< HEAD
 * Ngưỡng cảnh báo rule-based (ResultParameterThreshold) cho xét nghiệm máu (dịch vụ 'BLOODFULL', 27 chỉ số — mọi chỉ số đều có ngưỡng) VÀ các chỉ số số học của siêu âm tim / X-quang
=======
 * Ngưỡng cảnh báo rule-based (ResultParameterThreshold) cho xét nghiệm máu VÀ các chỉ số số học của siêu âm tim / X-quang
>>>>>>> origin/dev_updated
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
 * Các dải bên dưới là ngưỡng tham khảo từ hướng dẫn công bố; ngưỡng hs-Troponin T, CK-MB, NT-proBNP phụ thuộc
 * hãng máy/phương pháp. CẦN bác sĩ/phòng Lab duyệt trước khi dùng thật (đặc biệt các ngưỡng critical).
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

    const SRC = {
        HGB: 'WHO 2024 (thiếu máu: Hb <13 g/dL nam, <12 nữ — cần đối chiếu PDF WHO); ngưỡng trên: Mayo Clinic Labs; critical: Mayo/CAP (cơ sở tự quy định)',
        RBC_HCT_WBC_PLT_RDW: 'Mayo Clinic Laboratories — CBC reference ranges (test 9109, người lớn ≥18t); critical theo critical-value lists Mayo/CAP (cơ sở tự quy định)',
        MCV: 'Mayo Clinic Laboratories / Harrison — MCV 80–100 fL',
        INDICES: 'Tietz / Harrison — MCH, MCHC, MPV, công thức bạch cầu % (phụ thuộc analyzer, cần phòng Lab xác nhận)',
        ADA: 'ADA Standards of Care in Diabetes 2026 (glucose đói 70–99 · tiền ĐTĐ 100–125 · ĐTĐ ≥126); hạ đường huyết mức 2 <54; critical ≥400 theo Mayo',
        BUN: 'Tietz Textbook of Clinical Chemistry — Urea Nitrogen Reference Range (cần phòng Lab xác nhận)',
        CREA: 'Mayo Clinic Laboratories — creatinine (nam ≤1.35, nữ ≤1.04 mg/dL); phân độ theo KDIGO 2024; critical 7.0 cần phòng Lab xác nhận',
        ELEC: 'Mayo Clinic Laboratories — critical values Na⁺/K⁺; K⁺ 5.5/6.0 theo ESC 2021 HF; các mức K⁺ 5.1–5.9 cần phòng Lab xác nhận',
        ATP3: 'NCEP ATP III (2002) — Classification of lipids; AHA/ACC 2018 Cholesterol Guideline (TG, LDL-C); AHA/NHLBI metabolic syndrome (HDL-C theo giới)',
        TNT: 'ESC 2023 ACS Guidelines — hs-cTnT Elecsys: 99th percentile theo giới (nữ 9 · nam 17 ng/L; toàn dân 14); 52 ng/L = rule-in 0/1h; theo tờ hướng dẫn hãng/analyzer của phòng Lab',
        CKMB: 'CK-MB mass — giới hạn trên tham chiếu thường dùng ≈5 ng/mL (chỉ bổ trợ; ESC khuyến cáo hs-cTn; phụ thuộc assay, cần phòng Lab xác nhận)',
        NTPB: 'ESC 2021 Heart Failure Guidelines + ICON-RELOADED (JACC 2018): rule-out <125 pg/mL (ngoại trú); rule-in theo tuổi 450 / 900 / 1800 pg/mL',
        LVEF: 'ESC 2021 Heart Failure Guidelines — phân loại LVEF: ≥50% bảo tồn · 41–49% giảm nhẹ · ≤40% giảm; <30% giảm nặng (ngưỡng nguy kịch theo thực hành lâm sàng, cần bác sĩ siêu âm xác nhận)',
        ASE: 'ASE/EACVI Recommendations for Cardiac Chamber Quantification in Adults (Lang et al., 2015) — giới hạn bình thường & mức giãn theo giới (cần bác sĩ siêu âm xác nhận)',
        CTR: 'X-quang ngực thẳng (PA) người lớn: CTR > 50% gợi ý tim to; > 60% tim to rõ (ngưỡng thực hành thường quy, cần bác sĩ CĐHA xác nhận)',
    };

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

    const thresholds: ThresholdSeed[] = [
        // ═════════════ BLOODFULL — Xét nghiệm máu Full panel (người lớn ≥18 tuổi) ═════════════
        // Tất cả tham số máu nằm dưới 1 dịch vụ duy nhất; khe giữa các dải = `step` của analyzer (nhập số lẻ mịn hơn step có thể
        // rơi vào khe và không bị gắn cờ -> nên giới hạn số chữ số thập phân khi nhập).
        //
        // ── CBC (15 chỉ số) ──
        // Hemoglobin (g/dL): crit <7.0 · low 7.0–12.9 (nam) / 7.0–11.9 (nữ) · normal · high · crit ≥20.0
        ...build('BLOODFULL', 'HGB', [['critical', null], ['low', 7.0], ['normal', 13.0], ['high', 16.7], ['critical', 20.0]], { step: 0.1, gender: 'male', sourceReference: SRC.HGB }),
        ...build('BLOODFULL', 'HGB', [['critical', null], ['low', 7.0], ['normal', 12.0], ['high', 15.1], ['critical', 20.0]], { step: 0.1, gender: 'female', sourceReference: SRC.HGB }),
        // RBC (10^12/L): nam 4.35–5.65 · nữ 3.92–5.13
        ...build('BLOODFULL', 'RBC', [['low', null], ['normal', 4.35], ['high', 5.66]], { step: 0.01, gender: 'male', sourceReference: SRC.RBC_HCT_WBC_PLT_RDW }),
        ...build('BLOODFULL', 'RBC', [['low', null], ['normal', 3.92], ['high', 5.14]], { step: 0.01, gender: 'female', sourceReference: SRC.RBC_HCT_WBC_PLT_RDW }),
        // Hematocrit (%): nam 38.3–48.6 · nữ 35.5–44.9 · crit <20 / >60
        ...build('BLOODFULL', 'HCT', [['critical', null], ['low', 20.0], ['normal', 38.3], ['high', 48.7], ['critical', 60.1]], { step: 0.1, gender: 'male', sourceReference: SRC.RBC_HCT_WBC_PLT_RDW }),
        ...build('BLOODFULL', 'HCT', [['critical', null], ['low', 20.0], ['normal', 35.5], ['high', 45.0], ['critical', 60.1]], { step: 0.1, gender: 'female', sourceReference: SRC.RBC_HCT_WBC_PLT_RDW }),
        // MCV (fL) 80–100
        ...build('BLOODFULL', 'MCV', [['low', null], ['normal', 80.0], ['high', 100.1]], { step: 0.1, sourceReference: SRC.MCV }),
        // MCH (pg) 27–33 · MCHC (g/dL) 32–36
        ...build('BLOODFULL', 'MCH', [['low', null], ['normal', 27.0], ['high', 33.1]], { step: 0.1, sourceReference: SRC.INDICES }),
        ...build('BLOODFULL', 'MCHC', [['low', null], ['normal', 32.0], ['high', 36.1]], { step: 0.1, sourceReference: SRC.INDICES }),
        // RDW (%): chỉ cảnh báo khi tăng — nam ≤14.5 · nữ ≤16.1
        ...build('BLOODFULL', 'RDW', [['normal', null], ['high', 14.6]], { step: 0.1, gender: 'male', sourceReference: SRC.RBC_HCT_WBC_PLT_RDW }),
        ...build('BLOODFULL', 'RDW', [['normal', null], ['high', 16.2]], { step: 0.1, gender: 'female', sourceReference: SRC.RBC_HCT_WBC_PLT_RDW }),
        // WBC (10^9/L): normal 3.4–9.6 · low 2.0–3.3 · crit <2.0 / ≥30.0
        ...build('BLOODFULL', 'WBC', [['critical', null], ['low', 2.0], ['normal', 3.4], ['high', 9.7], ['critical', 30.0]], { step: 0.1, sourceReference: SRC.RBC_HCT_WBC_PLT_RDW }),
        // Công thức bạch cầu (%): NEUT 40–70 · LYMPH 20–40 · MONO ≤10 · EOS ≤6 · BASO ≤2
        ...build('BLOODFULL', 'NEUT', [['low', null], ['normal', 40.0], ['high', 70.1]], { step: 0.1, sourceReference: SRC.INDICES }),
        ...build('BLOODFULL', 'LYMPH', [['low', null], ['normal', 20.0], ['high', 40.1]], { step: 0.1, sourceReference: SRC.INDICES }),
        ...build('BLOODFULL', 'MONO', [['normal', null], ['high', 10.1]], { step: 0.1, sourceReference: SRC.INDICES }),
        ...build('BLOODFULL', 'EOS', [['normal', null], ['high', 6.1]], { step: 0.1, sourceReference: SRC.INDICES }),
        ...build('BLOODFULL', 'BASO', [['normal', null], ['high', 2.1]], { step: 0.1, sourceReference: SRC.INDICES }),
        // Tiểu cầu (10^9/L): nam 135–317 · nữ 157–371 · crit <50 / ≥1000
        ...build('BLOODFULL', 'PLT', [['critical', null], ['low', 50], ['normal', 135], ['high', 318], ['critical', 1000]], { step: 1, gender: 'male', sourceReference: SRC.RBC_HCT_WBC_PLT_RDW }),
        ...build('BLOODFULL', 'PLT', [['critical', null], ['low', 50], ['normal', 157], ['high', 372], ['critical', 1000]], { step: 1, gender: 'female', sourceReference: SRC.RBC_HCT_WBC_PLT_RDW }),
        // MPV (fL) 7.5–11.5
        ...build('BLOODFULL', 'MPV', [['low', null], ['normal', 7.5], ['high', 11.6]], { step: 0.1, sourceReference: SRC.INDICES }),

        // ── Sinh hóa cơ bản (mg/dL) ──
        // Glucose đói: crit <54 · low 54–69 · normal 70–99 · medium 100–125 (tiền ĐTĐ) · high 126–399 (ngưỡng ĐTĐ) · crit ≥400
        ...build('BLOODFULL', 'GLU', [['critical', null], ['low', 54], ['normal', 70], ['medium', 100], ['high', 126], ['critical', 400]], { step: 1, sourceReference: SRC.ADA }),
        // Urea / BUN: normal 7–20 · medium 21–40 · high 41–100 · crit >100
        ...build('BLOODFULL', 'URE', [['low', null], ['normal', 7], ['medium', 21], ['high', 41], ['critical', 101]], { step: 1, sourceReference: SRC.BUN }),
        // Creatinine (theo giới) — giá trị thấp không cảnh báo nên dải normal bắt đầu từ -∞
        // nam ≤1.35 · nữ ≤1.04 · medium -> 1.99 · high 2.0–6.99 · crit ≥7.0
        ...build('BLOODFULL', 'CREA', [['normal', null], ['medium', 1.36], ['high', 2.0], ['critical', 7.0]], { step: 0.01, gender: 'male', sourceReference: SRC.CREA }),
        ...build('BLOODFULL', 'CREA', [['normal', null], ['medium', 1.05], ['high', 2.0], ['critical', 7.0]], { step: 0.01, gender: 'female', sourceReference: SRC.CREA }),

        // ── Điện giải đồ (mmol/L) ──
        // Na⁺: crit ≤120 · low 121–134 · normal 135–145 · high 146–159 · crit ≥160
        ...build('BLOODFULL', 'NA', [['critical', null], ['low', 121], ['normal', 135], ['high', 146], ['critical', 160]], { step: 1, sourceReference: SRC.ELEC }),
        // K⁺: crit ≤2.5 · low 2.6–3.4 · normal 3.5–5.0 · medium 5.1–5.5 · high 5.6–5.9 · crit ≥6.0
        ...build('BLOODFULL', 'K', [['critical', null], ['low', 2.6], ['normal', 3.5], ['medium', 5.1], ['high', 5.6], ['critical', 6.0]], { step: 0.1, sourceReference: SRC.ELEC }),

        // ── Bộ mỡ máu (mg/dL) ──
        // Total Cholesterol: <200 mong muốn · 200–239 giáp ranh · ≥240 cao
        ...build('BLOODFULL', 'TC', [['normal', null], ['medium', 200], ['high', 240]], { step: 1, sourceReference: SRC.ATP3 }),
        // LDL-C: <130 · 130–159 giáp ranh · ≥160 cao (≥190 = tăng cholesterol nặng — gộp vào 'high' để tránh báo động giả)
        ...build('BLOODFULL', 'LDLC', [['normal', null], ['medium', 130], ['high', 160]], { step: 1, sourceReference: SRC.ATP3 }),
        // HDL-C: thấp là yếu tố nguy cơ (<40 nam, <50 nữ)
        ...build('BLOODFULL', 'HDLC', [['low', null], ['normal', 40]], { step: 1, gender: 'male', sourceReference: SRC.ATP3 }),
        ...build('BLOODFULL', 'HDLC', [['low', null], ['normal', 50]], { step: 1, gender: 'female', sourceReference: SRC.ATP3 }),
        // Triglyceride: <150 · 150–199 giáp ranh · 200–499 cao · ≥500 rất cao (nguy cơ viêm tụy)
        ...build('BLOODFULL', 'TG', [['normal', null], ['medium', 150], ['high', 200], ['critical', 500]], { step: 1, sourceReference: SRC.ATP3 }),

        // ── Dấu ấn tim mạch ──
        // hs-Troponin T (ng/L), theo giới: 99th percentile nữ 9 · nam 17; high tới 51; crit ≥52 (rule-in 0/1h)
        ...build('BLOODFULL', 'HSTNT', [['normal', null], ['high', 10], ['critical', 52]], { step: 1, gender: 'female', sourceReference: SRC.TNT }),
        ...build('BLOODFULL', 'HSTNT', [['normal', null], ['high', 18], ['critical', 52]], { step: 1, gender: 'male', sourceReference: SRC.TNT }),
        // CK-MB mass (ng/mL): chỉ bổ trợ
        ...build('BLOODFULL', 'CKMB', [['normal', null], ['high', 5.1]], { step: 0.1, sourceReference: SRC.CKMB }),
        // NT-proBNP (pg/mL): <125 normal · 125 -> (449 / 899 / 1799) medium · high từ 450 (<50t) / 900 (50–74t) / 1800 (≥75t)
        ...build('BLOODFULL', 'NTPROBNP', [['normal', null], ['medium', 125], ['high', 450]], { step: 1, ageMin: 18, ageMax: 49, sourceReference: SRC.NTPB }),
        ...build('BLOODFULL', 'NTPROBNP', [['normal', null], ['medium', 125], ['high', 900]], { step: 1, ageMin: 50, ageMax: 74, sourceReference: SRC.NTPB }),
        ...build('BLOODFULL', 'NTPROBNP', [['normal', null], ['medium', 125], ['high', 1800]], { step: 1, ageMin: 75, ageMax: ADULT_MAX, sourceReference: SRC.NTPB }),

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
