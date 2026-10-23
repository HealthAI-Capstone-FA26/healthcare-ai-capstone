import { PrismaService } from 'prisma/prisma.service';

/**
 * Ngưỡng cảnh báo rule-based (ResultParameterThreshold) cho xét nghiệm máu VÀ các chỉ số số học của siêu âm tim / X-quang
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
 * ⚠️ Các dải bên dưới là ngưỡng tham khảo từ hướng dẫn công bố; ngưỡng hs-Troponin T, CK-MB, NT-proBNP phụ thuộc
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
        CBC: "Harrison's Principles of Internal Medicine — CBC Reference Ranges",
        ADA: 'ADA Standards of Care in Diabetes 2024',
        BUN: 'Tietz Textbook of Clinical Chemistry — Urea Nitrogen Reference Range',
        KDIGO: 'KDIGO Clinical Practice Guideline for CKD 2024',
        ELEC: 'Tietz Textbook of Clinical Chemistry — Electrolyte reference & critical values (cần phòng Lab xác nhận)',
        ATP3: 'NCEP ATP III (2002) — Classification of lipids; AHA/NHLBI metabolic syndrome criteria (HDL-C theo giới)',
        TNT: 'ESC 2023 ACS Guidelines — hs-cTnT 99th percentile URL (Roche ≈14 ng/L; 52 ng/L = 5×URL rule-in 0/1h); ngưỡng theo assay của phòng Lab',
        CKMB: 'CK-MB mass — giới hạn trên tham chiếu thường dùng ≈5 ng/mL (phụ thuộc assay, cần phòng Lab xác nhận)',
        NTPB: 'ESC 2021 Heart Failure Guidelines + Januzzi et al. 2005 (ICON): rule-out < 125 pg/mL (ngoại trú); rule-in theo tuổi 450 / 900 / 1800 pg/mL',
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
        // ═════════════ CBC — Tổng phân tích tế bào máu (người lớn) ═════════════
        // RBC (10^12/L)
        ...build('CBC', 'RBC', [['critical', null], ['low', 3.0], ['normal', 4.7], ['high', 6.11], ['critical', 7.01]], { step: 0.01, gender: 'male', sourceReference: SRC.CBC }),
        ...build('CBC', 'RBC', [['critical', null], ['low', 2.51], ['normal', 4.2], ['high', 5.41], ['critical', 6.21]], { step: 0.01, gender: 'female', sourceReference: SRC.CBC }),
        // Hemoglobin (g/dL)
        ...build('CBC', 'HGB', [['critical', null], ['low', 7.0], ['normal', 13.0], ['high', 17.1], ['critical', 20.1]], { step: 0.1, gender: 'male', sourceReference: SRC.CBC }),
        ...build('CBC', 'HGB', [['critical', null], ['low', 7.0], ['normal', 12.0], ['high', 15.6], ['critical', 18.1]], { step: 0.1, gender: 'female', sourceReference: SRC.CBC }),
        // Hematocrit (%)
        ...build('CBC', 'HCT', [['critical', null], ['low', 21.0], ['normal', 41.0], ['high', 53.1], ['critical', 60.1]], { step: 0.1, gender: 'male', sourceReference: SRC.CBC }),
        ...build('CBC', 'HCT', [['critical', null], ['low', 21.0], ['normal', 36.0], ['high', 46.1], ['critical', 55.1]], { step: 0.1, gender: 'female', sourceReference: SRC.CBC }),
        // MCV (fL)
        ...build('CBC', 'MCV', [['low', null], ['normal', 80.0], ['high', 100.1]], { step: 0.1, sourceReference: SRC.CBC }),
        // WBC (10^9/L)
        ...build('CBC', 'WBC', [['critical', null], ['low', 2.0], ['normal', 4.0], ['high', 10.1], ['critical', 20.1]], { step: 0.1, sourceReference: SRC.CBC }),
        // Neutrophil % / Lymphocyte %
        ...build('CBC', 'NEUT', [['low', null], ['normal', 40.0], ['high', 60.1]], { step: 0.1, sourceReference: SRC.CBC }),
        ...build('CBC', 'LYMPH', [['low', null], ['normal', 20.0], ['high', 40.1]], { step: 0.1, sourceReference: SRC.CBC }),
        // Tiểu cầu (10^9/L)
        ...build('CBC', 'PLT', [['critical', null], ['low', 20], ['normal', 100], ['high', 451], ['critical', 1000]], { step: 1, sourceReference: SRC.CBC }),

        // ═════════════ BIOC01 — Sinh hóa cơ bản (mg/dL) ═════════════
        // Glucose đói
        ...build('BIOC01', 'GLU', [['low', null], ['normal', 70], ['medium', 100], ['high', 126], ['critical', 200]], { step: 1, sourceReference: SRC.ADA }),
        // Urea / BUN
        ...build('BIOC01', 'URE', [['low', null], ['normal', 7], ['medium', 21], ['high', 41], ['critical', 101]], { step: 1, sourceReference: SRC.BUN }),
        // Creatinine (theo giới) — giá trị thấp không cảnh báo nên dải normal bắt đầu từ -∞
        ...build('BIOC01', 'CREA', [['normal', null], ['medium', 1.31], ['high', 2.01], ['critical', 4.01]], { step: 0.01, gender: 'male', sourceReference: SRC.KDIGO }),
        ...build('BIOC01', 'CREA', [['normal', null], ['medium', 1.11], ['high', 1.81], ['critical', 3.51]], { step: 0.01, gender: 'female', sourceReference: SRC.KDIGO }),

        // ═════════════ ELEC01 — Điện giải đồ (mmol/L) ═════════════
        ...build('ELEC01', 'NA', [['critical', null], ['low', 120], ['normal', 135], ['high', 146], ['critical', 160]], { step: 1, sourceReference: SRC.ELEC }),
        ...build('ELEC01', 'K', [['critical', null], ['low', 2.5], ['normal', 3.5], ['high', 5.1], ['critical', 6.0]], { step: 0.1, sourceReference: SRC.ELEC }),

        // ═════════════ LIPID01 — Bộ mỡ máu (mg/dL) ═════════════
        // Total Cholesterol: <200 mong muốn · 200–239 giáp ranh · ≥240 cao
        ...build('LIPID01', 'TC', [['normal', null], ['medium', 200], ['high', 240]], { step: 1, sourceReference: SRC.ATP3 }),
        // LDL-C: <130 bình thường/gần tối ưu · 130–159 giáp ranh · ≥160 cao (≥190 rất cao — gộp vào 'high' để tránh báo động giả)
        ...build('LIPID01', 'LDLC', [['normal', null], ['medium', 130], ['high', 160]], { step: 1, sourceReference: SRC.ATP3 }),
        // HDL-C: thấp là yếu tố nguy cơ (<40 nam, <50 nữ)
        ...build('LIPID01', 'HDLC', [['low', null], ['normal', 40]], { step: 1, gender: 'male', sourceReference: SRC.ATP3 }),
        ...build('LIPID01', 'HDLC', [['low', null], ['normal', 50]], { step: 1, gender: 'female', sourceReference: SRC.ATP3 }),
        // Triglyceride: <150 · 150–199 giáp ranh · 200–499 cao · ≥500 rất cao (nguy cơ viêm tụy)
        ...build('LIPID01', 'TG', [['normal', null], ['medium', 150], ['high', 200], ['critical', 500]], { step: 1, sourceReference: SRC.ATP3 }),

        // ═════════════ Dấu ấn tim mạch ═════════════
        // hs-Troponin T (ng/L): ≤14 bình thường · 15–51 tăng (cần chuỗi 0/1h) · ≥52 rất nghi tổn thương cơ tim
        ...build('HSTNT', 'HSTNT', [['normal', null], ['high', 15], ['critical', 52]], { step: 1, sourceReference: SRC.TNT }),
        // CK-MB mass (ng/mL)
        ...build('CKMB', 'CKMB', [['normal', null], ['high', 5.1]], { step: 0.1, sourceReference: SRC.CKMB }),
        // NT-proBNP (pg/mL): ngưỡng "high" (rule-in suy tim cấp) tăng theo tuổi
        ...build('NTPROBNP', 'NTPROBNP', [['normal', null], ['medium', 125], ['high', 450]], { step: 1, ageMin: 18, ageMax: 49, sourceReference: SRC.NTPB }),
        ...build('NTPROBNP', 'NTPROBNP', [['normal', null], ['medium', 125], ['high', 900]], { step: 1, ageMin: 50, ageMax: 74, sourceReference: SRC.NTPB }),
        ...build('NTPROBNP', 'NTPROBNP', [['normal', null], ['medium', 125], ['high', 1800]], { step: 1, ageMin: 75, ageMax: ADULT_MAX, sourceReference: SRC.NTPB }),

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
    console.log(`Seeded ${rows.length} result parameter thresholds (blood_test + echo + xray), active in DB: ${count}`);
}
