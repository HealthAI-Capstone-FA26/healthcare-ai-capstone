import { PrismaService } from 'prisma/prisma.service';

/**
 * file này tra `parameterCode` qua `prisma.labResultParameter.findMany()` bên dưới, nhưng
 * trước đây KHÔNG có seed nào tạo dữ liệu LabResultParameter (bảng này không có endpoint tạo
 * qua API) và fs.readdirSync() không đảm bảo thứ tự chạy — nên trên thực tế `paramMap` luôn
 * RỖNG, seed "chạy thành công" nhưng 0 dòng nào được tạo. Đã bổ sung 05-lab-room.seed.ts ->
 * 06-test-catalog.seed.ts -> 07-lab-result-parameter.seed.ts (đúng chuỗi phụ thuộc
 * LabRoom -> TestCatalog -> LabResultParameter) và đổi tên file này thêm tiền tố "20-" để
 * đảm bảo chạy SAU (xem cơ chế sort theo tiền tố số trong prisma/seed.ts). Với parameterCode
 * mẫu GLU/HGB/WBC/PLT/CREA đã khớp với 07-lab-result-parameter.seed.ts, seed dưới đây giờ sẽ
 * thực sự tạo được dữ liệu.
 *
 * Seed ngưỡng cảnh báo cho các tham số xét nghiệm phổ biến (LabParameterThreshold),
 * theo đúng tinh thần của seedVitalSignThresholds (vital-sign-threshold.seed.ts):
 * mỗi dòng khai báo 1 dải nguy cơ (riskLevel) cho 1 khoảng tuổi, kèm nguồn tham chiếu.
 *
 * KHÁC BIỆT so với vital threshold: 1 tham số ở đây có THỂ có NHIỀU dòng (normal, low,
 * medium, high, critical) thay vì gộp min/max normal + critical trong 1 dòng như vital.
 * Điều này cho phép mô hình hoá đúng các thang phân loại lâm sàng nhiều bậc
 * (VD: Glucose đói: bình thường / tiền đái tháo đường / đái tháo đường / nguy kịch).
 *
 * Đội ngũ dev sẽ cập nhật nguồn chính thống và bổ sung thêm các tham số/xét nghiệm khác.
 * Ví dụ dưới đây chỉ minh hoạ cho 1 nhóm xét nghiệm mẫu (Công thức máu + Sinh hoá cơ bản)
 * — cần đối chiếu parameterCode với danh mục LabResultParameter thật đã seed cho từng TestCatalog.
 */
export async function seedLabParameterThresholds(prisma: PrismaService) {
    const parameters = await prisma.labResultParameter.findMany();
    // parameterCode chỉ duy nhất TRONG PHẠM VI 1 testTypeId (@@unique([testTypeId, parameterCode])),
    // nên map theo `${testTypeCode}:${parameterCode}` nếu hệ thống có nhiều testType dùng chung mã tham số.
    // Ở đây giả định các parameterCode mẫu bên dưới là duy nhất toàn hệ thống để đơn giản hoá seed mẫu.
    const paramMap = new Map(parameters.map((p) => [p.parameterCode, p.parameterId]));

    const glucoseId = paramMap.get('GLU');
    const hbId = paramMap.get('HGB');
    const wbcId = paramMap.get('WBC');
    const pltId = paramMap.get('PLT');
    const creatinineId = paramMap.get('CREA');

    const effectiveFrom = new Date('2026-01-01');

    const SOURCE_ADA = 'ADA Standards of Care in Diabetes 2024';
    const SOURCE_CBC_ADULT = 'Harrison\'s Principles of Internal Medicine — CBC Reference Ranges';
    const SOURCE_KDIGO = 'KDIGO Clinical Practice Guideline for CKD 2024';

    interface ThresholdSeed {
        parameterId: string | undefined;
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

        // BẠCH CẦU (WBC, x10^9/L) — người lớn, không phân biệt giới tính
        { parameterId: wbcId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'critical', rangeMin: null, rangeMax: 1.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: wbcId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'low', rangeMin: 2.0, rangeMax: 3.9, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: wbcId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'normal', rangeMin: 4.0, rangeMax: 10.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: wbcId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'high', rangeMin: 10.1, rangeMax: 20.0, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: wbcId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'critical', rangeMin: 20.1, rangeMax: null, sourceReference: SOURCE_CBC_ADULT },

        // TIỂU CẦU (PLT, x10^9/L) — người lớn, không phân biệt giới tính
        { parameterId: pltId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'critical', rangeMin: null, rangeMax: 19, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: pltId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'high', rangeMin: 20, rangeMax: 99, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: pltId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'normal', rangeMin: 100, rangeMax: 450, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: pltId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'high', rangeMin: 451, rangeMax: 999, sourceReference: SOURCE_CBC_ADULT },
        { parameterId: pltId, ageMin: 18, ageMax: 120, gender: null, riskLevel: 'critical', rangeMin: 1000, rangeMax: null, sourceReference: SOURCE_CBC_ADULT },

        // CREATININE (mg/dL) — theo giới tính, người lớn
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'normal', rangeMin: 0.7, rangeMax: 1.3, sourceReference: SOURCE_KDIGO },
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'medium', rangeMin: 1.31, rangeMax: 2.0, sourceReference: SOURCE_KDIGO },
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'high', rangeMin: 2.01, rangeMax: 4.0, sourceReference: SOURCE_KDIGO },
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'male', riskLevel: 'critical', rangeMin: 4.01, rangeMax: null, sourceReference: SOURCE_KDIGO },

        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'normal', rangeMin: 0.6, rangeMax: 1.1, sourceReference: SOURCE_KDIGO },
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'medium', rangeMin: 1.11, rangeMax: 1.8, sourceReference: SOURCE_KDIGO },
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'high', rangeMin: 1.81, rangeMax: 3.5, sourceReference: SOURCE_KDIGO },
        { parameterId: creatinineId, ageMin: 18, ageMax: 120, gender: 'female', riskLevel: 'critical', rangeMin: 3.51, rangeMax: null, sourceReference: SOURCE_KDIGO },
    ];

    await prisma.labParameterThreshold.deleteMany();

    let seededCount = 0;
    for (const t of thresholds) {
        if (!t.parameterId) continue;
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
                // sourceReference: t.sourceReference, // TODO: bật lại sau khi thêm cột vào schema
            },
        });
        seededCount++;
    }

    const count = await prisma.labParameterThreshold.count();
    console.log(`Seeded ${seededCount} lab parameter thresholds, total in DB: ${count}`);
}
