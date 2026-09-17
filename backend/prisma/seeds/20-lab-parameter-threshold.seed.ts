import { PrismaService } from 'prisma/prisma.service';

/**
 * Seed ngưỡng cảnh báo cho các tham số xét nghiệm phổ biến (LabParameterThreshold),
 * theo đúng tinh thần của seedVitalSignThresholds (vital-sign-threshold.seed.ts):
 * mỗi dòng khai báo 1 dải nguy cơ (riskLevel) cho 1 khoảng tuổi, kèm nguồn tham chiếu.
 *
 * KHÁC BIỆT so với vital threshold: 1 tham số ở đây có THỂ có NHIỀU dòng (normal, low,
 * medium, high, critical) thay vì gộp min/max normal + critical trong 1 dòng như vital.
 * Điều này cho phép mô hình hoá đúng các thang phân loại lâm sàng nhiều bậc
 * (VD: Glucose đói: bình thường / tiền đái tháo đường / đái tháo đường / nguy kịch).
 *
 * QUAN TRỌNG — SỬA LỖI TRA CỨU parameterCode: `@@unique` của LabResultParameter là
 * [testTypeId, parameterCode], nghĩa là CÙNG một parameterCode có thể tồn tại ở nhiều
 * testType (vd. GLU ở cả BIOC01 lẫn tương lai có thể có ở test khác). Nếu dựng
 * `Map<parameterCode, parameterId>` như bản cũ, một mã trùng sẽ bị GHI ĐÈ ÂM THẦM và
 * gán nhầm ngưỡng sang sai test — đây là lỗi lâm sàng, không chỉ lỗi dữ liệu. Do đó map
 * ở đây bắt buộc dựng theo CẶP `${testTypeId}:${parameterCode}`, tra cứu qua testCode
 * (ổn định, không đổi) chứ không qua testTypeId (UUID sinh ra lúc chạy seed).
 *
 * Đồng thời, `getParameterId()` NÉM LỖI nếu không tìm thấy — thay vì `if (!id) continue`
 * như bản cũ, vốn khiến ngưỡng bị thiếu âm thầm mà seed vẫn báo "thành công".
 *
 * Phụ thuộc 07-lab-result-parameter.seed.ts đã chạy trước (tiền tố "20-" đảm bảo thứ tự).
 */
export async function seedLabParameterThresholds(prisma: PrismaService) {
    const testTypes = await prisma.testCatalog.findMany();
    const testCodeToId = new Map(testTypes.map((t) => [t.testCode, t.testTypeId]));

    const parameters = await prisma.labResultParameter.findMany();
    const paramMap = new Map(
        parameters.map((p) => [`${p.testTypeId}:${p.parameterCode}`, p.parameterId]),
    );

    /** Tra parameterId theo CẶP (testCode, parameterCode) — không bao giờ theo parameterCode đơn lẻ. */
    const getParameterId = (testCode: string, parameterCode: string): string => {
        const testTypeId = testCodeToId.get(testCode);
        if (!testTypeId) {
            throw new Error(
                `Không tìm thấy TestCatalog có testCode='${testCode}' — kiểm tra 06-test-catalog.seed.ts đã chạy trước.`,
            );
        }
        const id = paramMap.get(`${testTypeId}:${parameterCode}`);
        if (!id) {
            throw new Error(
                `Không tìm thấy LabResultParameter '${parameterCode}' thuộc test '${testCode}' — kiểm tra 07-lab-result-parameter.seed.ts đã chạy trước và mã tham số khớp nhau.`,
            );
        }
        return id;
    };

    const glucoseId = getParameterId('BIOC01', 'GLU');
    const ureaId = getParameterId('BIOC01', 'URE');
    const creatinineId = getParameterId('BIOC01', 'CREA');

    const rbcId = getParameterId('CBC', 'RBC');
    const hbId = getParameterId('CBC', 'HGB');
    const hctId = getParameterId('CBC', 'HCT');
    const mcvId = getParameterId('CBC', 'MCV');
    const wbcId = getParameterId('CBC', 'WBC');
    const neutId = getParameterId('CBC', 'NEUT');
    const lymphId = getParameterId('CBC', 'LYMPH');
    const pltId = getParameterId('CBC', 'PLT');

    const effectiveFrom = new Date('2026-01-01');

    const SOURCE_ADA = 'ADA Standards of Care in Diabetes 2024';
    const SOURCE_CBC_ADULT = 'Harrison\'s Principles of Internal Medicine — CBC Reference Ranges';
    const SOURCE_KDIGO = 'KDIGO Clinical Practice Guideline for CKD 2024';
    const SOURCE_BUN = 'Tietz Textbook of Clinical Chemistry — Urea Nitrogen Reference Range';

    interface ThresholdSeed {
        parameterId: string;
        ageMin: number;
        ageMax: number;
        gender: string | null;
        riskLevel: 'normal' | 'low' | 'medium' | 'high' | 'critical';
        rangeMin: number | null;
        rangeMax: number | null;
        sourceReference: string;
    }

    const thresholds: ThresholdSeed[] = [
        // GLUCOSE ĐÓI (mg/dL) — người lớn 18-120 tuổi, không phân biệt giới tính
        { parameterId: glucoseId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'low', rangeMin: null, rangeMax: 69, sourceReference: SOURCE_ADA },
        { parameterId: glucoseId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'normal', rangeMin: 70, rangeMax: 99, sourceReference: SOURCE_ADA },
        { parameterId: glucoseId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'medium', rangeMin: 100, rangeMax: 125, sourceReference: SOURCE_ADA },
        { parameterId: glucoseId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'high', rangeMin: 126, rangeMax: 199, sourceReference: SOURCE_ADA },
        { parameterId: glucoseId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'critical', rangeMin: 200, rangeMax: null, sourceReference: SOURCE_ADA },

        // UREA / BUN (mg/dL) — người lớn, không phân biệt giới tính
        { parameterId: ureaId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'low', rangeMin: null, rangeMax: 6, sourceReference: SOURCE_BUN },
        { parameterId: ureaId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'normal', rangeMin: 7, rangeMax: 20, sourceReference: SOURCE_BUN },
        { parameterId: ureaId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'medium', rangeMin: 21, rangeMax: 40, sourceReference: SOURCE_BUN },
        { parameterId: ureaId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'high', rangeMin: 41, rangeMax: 100, sourceReference: SOURCE_BUN },
        { parameterId: ureaId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'critical', rangeMin: 101, rangeMax: null, sourceReference: SOURCE_BUN },

        // CREATININE (mg/dL) — theo giới tính, người lớn
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'normal', rangeMin: 0.7, rangeMax: 1.3, sourceReference: SOURCE_KDIGO },
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'medium', rangeMin: 1.31, rangeMax: 2.0, sourceReference: SOURCE_KDIGO },
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'high', rangeMin: 2.01, rangeMax: 4.0, sourceReference: SOURCE_KDIGO },
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'critical', rangeMin: 4.01, rangeMax: null, sourceReference: SOURCE_KDIGO },

        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'normal', rangeMin: 0.6, rangeMax: 1.1, sourceReference: SOURCE_KDIGO },
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'medium', rangeMin: 1.11, rangeMax: 1.8, sourceReference: SOURCE_KDIGO },
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'high', rangeMin: 1.81, rangeMax: 3.5, sourceReference: SOURCE_KDIGO },
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'critical', rangeMin: 3.51, rangeMax: null, sourceReference: SOURCE_KDIGO },

        // HỒNG CẦU (RBC, x10^12/L) — theo giới tính, người lớn
        { parameterId: rbcId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'critical', rangeMin: null, rangeMax: 2.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: rbcId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'low', rangeMin: 3.0, rangeMax: 4.69, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: rbcId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'normal', rangeMin: 4.7, rangeMax: 6.1, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: rbcId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'high', rangeMin: 6.11, rangeMax: 7.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: rbcId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'critical', rangeMin: 7.01, rangeMax: null, sourceReference: SOURCE_CBC_ADULT },

        { parameterId: rbcId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'critical', rangeMin: null, rangeMax: 2.5, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: rbcId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'low', rangeMin: 2.51, rangeMax: 4.19, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: rbcId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'normal', rangeMin: 4.2, rangeMax: 5.4, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: rbcId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'high', rangeMin: 5.41, rangeMax: 6.2, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: rbcId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'critical', rangeMin: 6.21, rangeMax: null, sourceReference: SOURCE_CBC_ADULT },

        // HEMOGLOBIN (g/dL) — theo giới tính, người lớn
        { parameterId: hbId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'critical', rangeMin: null, rangeMax: 6.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hbId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'low', rangeMin: 7.0, rangeMax: 12.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hbId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'normal', rangeMin: 13.0, rangeMax: 17.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hbId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'high', rangeMin: 17.1, rangeMax: 20.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hbId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'critical', rangeMin: 20.1, rangeMax: null, sourceReference: SOURCE_CBC_ADULT },

        { parameterId: hbId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'critical', rangeMin: null, rangeMax: 6.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hbId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'low', rangeMin: 7.0, rangeMax: 11.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hbId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'normal', rangeMin: 12.0, rangeMax: 15.5, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hbId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'high', rangeMin: 15.6, rangeMax: 18.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hbId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'critical', rangeMin: 18.1, rangeMax: null, sourceReference: SOURCE_CBC_ADULT },

        // HEMATOCRIT (%) — theo giới tính, người lớn
        { parameterId: hctId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'critical', rangeMin: null, rangeMax: 20.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hctId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'low', rangeMin: 21.0, rangeMax: 40.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hctId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'normal', rangeMin: 41.0, rangeMax: 53.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hctId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'high', rangeMin: 53.1, rangeMax: 60.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hctId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'critical', rangeMin: 60.1, rangeMax: null, sourceReference: SOURCE_CBC_ADULT },

        { parameterId: hctId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'critical', rangeMin: null, rangeMax: 20.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hctId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'low', rangeMin: 21.0, rangeMax: 35.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hctId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'normal', rangeMin: 36.0, rangeMax: 46.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hctId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'high', rangeMin: 46.1, rangeMax: 55.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: hctId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'critical', rangeMin: 55.1, rangeMax: null, sourceReference: SOURCE_CBC_ADULT },

        // MCV (fL) — không phân biệt giới tính; dùng phân loại thiếu máu nhỏ/to hồng cầu
        { parameterId: mcvId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'low', rangeMin: null, rangeMax: 79.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: mcvId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'normal', rangeMin: 80.0, rangeMax: 100.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: mcvId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'high', rangeMin: 100.1, rangeMax: null, sourceReference: SOURCE_CBC_ADULT },

        // BẠCH CẦU (WBC, x10^9/L) — người lớn, không phân biệt giới tính
        { parameterId: wbcId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'critical', rangeMin: null, rangeMax: 1.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: wbcId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'low', rangeMin: 2.0, rangeMax: 3.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: wbcId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'normal', rangeMin: 4.0, rangeMax: 10.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: wbcId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'high', rangeMin: 10.1, rangeMax: 20.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: wbcId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'critical', rangeMin: 20.1, rangeMax: null, sourceReference: SOURCE_CBC_ADULT },

        // NEUTROPHIL % — người lớn, không phân biệt giới tính (định hướng nhiễm khuẩn)
        { parameterId: neutId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'low', rangeMin: null, rangeMax: 39.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: neutId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'normal', rangeMin: 40.0, rangeMax: 60.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: neutId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'high', rangeMin: 60.1, rangeMax: null, sourceReference: SOURCE_CBC_ADULT },

        // LYMPHOCYTE % — người lớn, không phân biệt giới tính (định hướng nhiễm virus)
        { parameterId: lymphId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'low', rangeMin: null, rangeMax: 19.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: lymphId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'normal', rangeMin: 20.0, rangeMax: 40.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: lymphId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'high', rangeMin: 40.1, rangeMax: null, sourceReference: SOURCE_CBC_ADULT },

        // TIỂU CẦU (PLT, x10^9/L) — người lớn, không phân biệt giới tính
        { parameterId: pltId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'critical', rangeMin: null, rangeMax: 19, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: pltId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'high', rangeMin: 20, rangeMax: 99, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: pltId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'normal', rangeMin: 100, rangeMax: 450, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: pltId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'high', rangeMin: 451, rangeMax: 999, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: pltId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'critical', rangeMin: 1000, rangeMax: null, sourceReference: SOURCE_CBC_ADULT },
    ];

    await prisma.labParameterThreshold.deleteMany();

    for (const t of thresholds) {
        await prisma.labParameterThreshold.create({
            data: {
                parameterId: t.parameterId,
                ageMin: t.ageMin,
                ageMax: t.ageMax,
                gender: t.gender,
                riskLevel: t.riskLevel,
                rangeMin: t.rangeMin,
                rangeMax: t.rangeMax,
                isActive: true,
                effectiveFrom,
                sourceReference: t.sourceReference
            },
        });
    }

    const count = await prisma.labParameterThreshold.count();
    console.log(`Seeded ${thresholds.length} lab parameter thresholds, total in DB: ${count}`);
}