import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';

/**
 * Danh mục tham số kết quả (ResultParameter) cho:
 *   - blood_test : toàn bộ tham số dataType = 'numeric'.
 *   - echo (TTE) : chỉ số siêu âm tim có cấu trúc — numeric (LVEF, LVIDD, LA_DIAM), enum (mức độ hở/hẹp van),
 *                  boolean (RWMA, tràn dịch màng ngoài tim).
 *   - xray (CXRPA): chỉ số X-quang ngực — numeric (CTR), enum (ứ huyết phổi, tràn dịch màng phổi), boolean (đông đặc/thâm nhiễm).
 * Echo/X-quang là 'image_report': nhập kết quả vẫn BẮT BUỘC có findings/kết luận; các tham số này là phần ĐO ĐẠC có cấu trúc
 * (tuỳ chọn khi nhập) để theo dõi xu hướng và cảnh báo rule-based.
 *
 * RuleBasedLabDetector: numeric -> so ngưỡng (20-...) · boolean -> true = bất thường (mức 'high') · enum/text -> KHÔNG tự đánh giá.
 * Vì vậy boolean ở đây đều mô tả "CÓ dấu hiệu bệnh lý".
 *
 * ⚠️ Mã LOINC của các chỉ số echo/X-quang để trống (null) — chưa xác nhận; cần bổ sung nếu liên thông HIS/FHIR.
 *
 * QUAN TRỌNG: @@unique là [serviceId, parameterCode] -> tra cứu BẮT BUỘC theo cặp (serviceCode, parameterCode),
 * không bao giờ chỉ theo parameterCode (xem 20-result-parameter-threshold.seed.ts).
 *
 * Mã LOINC lấy theo loinc.org; một số mã (hs-Troponin T, CK-MB, NT-proBNP, LDL-C) phụ thuộc phương pháp/hãng máy
 * -> cần phòng Lab xác nhận lại theo analyzer thực tế.
 *
 * Phụ thuộc ServiceCatalog (06-service-catalog.seed.ts) — seed này chạy SAU.
 */
export async function seedResultParameters(prisma: PrismaService): Promise<void> {
    const services = await prisma.serviceCatalog.findMany({ where: { modality: { in: ['blood_test', 'echo', 'xray'] } } });
    const serviceMap = new Map(services.map((s) => [s.serviceCode, s.serviceId]));

    type ParamSeed = {
        serviceCode: string;
        parameterCode: string;
        parameterName: string;
        loincCode: string | null;
        unit: string | null;
        displayOrder: number;
        dataType?: 'numeric' | 'boolean' | 'enum' | 'text';
        allowedValues?: { value: string; label: string }[];
    };

    const grade5 = [
        { value: 'none', label: 'Không' },
        { value: 'trace', label: 'Vết' },
        { value: 'mild', label: 'Nhẹ' },
        { value: 'moderate', label: 'Vừa' },
        { value: 'severe', label: 'Nặng' },
    ];
    const grade4 = grade5.filter((g) => g.value !== 'trace');

    const parameters: ParamSeed[] = [
        { serviceCode: 'CBC', parameterCode: 'RBC', parameterName: 'Số lượng hồng cầu (RBC)', loincCode: '789-8', unit: '10^12/L', displayOrder: 1 },
        { serviceCode: 'CBC', parameterCode: 'HGB', parameterName: 'Hemoglobin', loincCode: '718-7', unit: 'g/dL', displayOrder: 2 },
        { serviceCode: 'CBC', parameterCode: 'HCT', parameterName: 'Hematocrit (dung tích hồng cầu)', loincCode: '4544-3', unit: '%', displayOrder: 3 },
        { serviceCode: 'CBC', parameterCode: 'MCV', parameterName: 'Thể tích trung bình hồng cầu (MCV)', loincCode: '787-2', unit: 'fL', displayOrder: 4 },
        { serviceCode: 'CBC', parameterCode: 'MCH', parameterName: 'Lượng Hb trung bình hồng cầu (MCH)', loincCode: '785-6', unit: 'pg', displayOrder: 5 },
        { serviceCode: 'CBC', parameterCode: 'MCHC', parameterName: 'Nồng độ Hb trung bình hồng cầu (MCHC)', loincCode: '786-4', unit: 'g/dL', displayOrder: 6 },
        { serviceCode: 'CBC', parameterCode: 'RDW', parameterName: 'Độ phân bố kích thước hồng cầu (RDW)', loincCode: '788-0', unit: '%', displayOrder: 7 },
        { serviceCode: 'CBC', parameterCode: 'WBC', parameterName: 'Bạch cầu (WBC)', loincCode: '6690-2', unit: '10^9/L', displayOrder: 8 },
        { serviceCode: 'CBC', parameterCode: 'NEUT', parameterName: 'Bạch cầu trung tính (Neutrophil %)', loincCode: '770-8', unit: '%', displayOrder: 9 },
        { serviceCode: 'CBC', parameterCode: 'LYMPH', parameterName: 'Bạch cầu lympho (Lymphocyte %)', loincCode: '736-9', unit: '%', displayOrder: 10 },
        { serviceCode: 'CBC', parameterCode: 'MONO', parameterName: 'Bạch cầu mono (Monocyte %)', loincCode: '5905-5', unit: '%', displayOrder: 11 },
        { serviceCode: 'CBC', parameterCode: 'EOS', parameterName: 'Bạch cầu ái toan (Eosinophil %)', loincCode: '713-8', unit: '%', displayOrder: 12 },
        { serviceCode: 'CBC', parameterCode: 'BASO', parameterName: 'Bạch cầu ái kiềm (Basophil %)', loincCode: '706-2', unit: '%', displayOrder: 13 },
        { serviceCode: 'CBC', parameterCode: 'PLT', parameterName: 'Tiểu cầu (Platelet)', loincCode: '777-3', unit: '10^9/L', displayOrder: 14 },
        { serviceCode: 'CBC', parameterCode: 'MPV', parameterName: 'Thể tích trung bình tiểu cầu (MPV)', loincCode: '776-5', unit: 'fL', displayOrder: 15 },
        { serviceCode: 'BIOC01', parameterCode: 'GLU', parameterName: 'Glucose (đói)', loincCode: '2345-7', unit: 'mg/dL', displayOrder: 1 },
        { serviceCode: 'BIOC01', parameterCode: 'URE', parameterName: 'Urea (BUN)', loincCode: '3094-0', unit: 'mg/dL', displayOrder: 2 },
        { serviceCode: 'BIOC01', parameterCode: 'CREA', parameterName: 'Creatinine', loincCode: '2160-0', unit: 'mg/dL', displayOrder: 3 },
        { serviceCode: 'ELEC01', parameterCode: 'NA', parameterName: 'Natri (Na+)', loincCode: '2951-2', unit: 'mmol/L', displayOrder: 1 },
        { serviceCode: 'ELEC01', parameterCode: 'K', parameterName: 'Kali (K+)', loincCode: '2823-3', unit: 'mmol/L', displayOrder: 2 },
        { serviceCode: 'LIPID01', parameterCode: 'TC', parameterName: 'Cholesterol toàn phần (Total Cholesterol)', loincCode: '2093-3', unit: 'mg/dL', displayOrder: 1 },
        { serviceCode: 'LIPID01', parameterCode: 'LDLC', parameterName: 'LDL-Cholesterol', loincCode: '13457-7', unit: 'mg/dL', displayOrder: 2 },
        { serviceCode: 'LIPID01', parameterCode: 'HDLC', parameterName: 'HDL-Cholesterol', loincCode: '2085-9', unit: 'mg/dL', displayOrder: 3 },
        { serviceCode: 'LIPID01', parameterCode: 'TG', parameterName: 'Triglyceride', loincCode: '2571-8', unit: 'mg/dL', displayOrder: 4 },
        { serviceCode: 'HSTNT', parameterCode: 'HSTNT', parameterName: 'hs-Troponin T', loincCode: '67151-1', unit: 'ng/L', displayOrder: 1 },
        { serviceCode: 'CKMB', parameterCode: 'CKMB', parameterName: 'CK-MB (mass)', loincCode: '20109-5', unit: 'ng/mL', displayOrder: 1 },
        { serviceCode: 'NTPROBNP', parameterCode: 'NTPROBNP', parameterName: 'NT-proBNP', loincCode: '33762-6', unit: 'pg/mL', displayOrder: 1 },

        // ── TTE — Siêu âm tim qua thành ngực ──
        { serviceCode: 'TTE', parameterCode: 'LVEF', parameterName: 'Phân suất tống máu thất trái (LVEF)', loincCode: null, unit: '%', displayOrder: 1 },
        { serviceCode: 'TTE', parameterCode: 'LVIDD', parameterName: 'Đường kính thất trái cuối tâm trương (LVIDd)', loincCode: null, unit: 'mm', displayOrder: 2 },
        { serviceCode: 'TTE', parameterCode: 'LA_DIAM', parameterName: 'Đường kính nhĩ trái (trục dọc cạnh ức)', loincCode: null, unit: 'mm', displayOrder: 3 },
        { serviceCode: 'TTE', parameterCode: 'MR_GRADE', parameterName: 'Hở van hai lá', loincCode: null, unit: null, displayOrder: 4, dataType: 'enum', allowedValues: grade5 },
        { serviceCode: 'TTE', parameterCode: 'AR_GRADE', parameterName: 'Hở van động mạch chủ', loincCode: null, unit: null, displayOrder: 5, dataType: 'enum', allowedValues: grade5 },
        { serviceCode: 'TTE', parameterCode: 'AS_GRADE', parameterName: 'Hẹp van động mạch chủ', loincCode: null, unit: null, displayOrder: 6, dataType: 'enum', allowedValues: grade4 },
        { serviceCode: 'TTE', parameterCode: 'RWMA', parameterName: 'Rối loạn vận động vùng thành tim (RWMA)', loincCode: null, unit: null, displayOrder: 7, dataType: 'boolean' },
        { serviceCode: 'TTE', parameterCode: 'PERICARD_EFF', parameterName: 'Tràn dịch màng ngoài tim', loincCode: null, unit: null, displayOrder: 8, dataType: 'boolean' },

        // ── CXRPA — X-quang ngực thẳng ──
        { serviceCode: 'CXRPA', parameterCode: 'CTR', parameterName: 'Chỉ số tim–ngực (CTR)', loincCode: null, unit: '%', displayOrder: 1 },
        { serviceCode: 'CXRPA', parameterCode: 'PULM_CONGESTION', parameterName: 'Ứ huyết phổi / phù phổi', loincCode: null, unit: null, displayOrder: 2, dataType: 'enum', allowedValues: grade4 },
        { serviceCode: 'CXRPA', parameterCode: 'PLEURAL_EFF', parameterName: 'Tràn dịch màng phổi', loincCode: null, unit: null, displayOrder: 3, dataType: 'enum', allowedValues: [
            { value: 'none', label: 'Không' },
            { value: 'left', label: 'Bên trái' },
            { value: 'right', label: 'Bên phải' },
            { value: 'bilateral', label: 'Hai bên' },
        ] },
        { serviceCode: 'CXRPA', parameterCode: 'LUNG_OPACITY', parameterName: 'Đông đặc / thâm nhiễm nhu mô phổi', loincCode: null, unit: null, displayOrder: 4, dataType: 'boolean' },
    ];

    for (const p of parameters) {
        const serviceId = serviceMap.get(p.serviceCode);
        if (!serviceId) {
            throw new Error(
                `Không tìm thấy ServiceCatalog có serviceCode='${p.serviceCode}' — hãy chắc chắn 06-service-catalog.seed.ts đã chạy trước.`,
            );
        }

        const data = {
            parameterName: p.parameterName,
            loincCode: p.loincCode,
            unit: p.unit,
            dataType: p.dataType ?? 'numeric',
            allowedValues: p.allowedValues ?? Prisma.JsonNull,
            displayOrder: p.displayOrder,
            isActive: true,
        };

        await prisma.resultParameter.upsert({
            where: { serviceId_parameterCode: { serviceId, parameterCode: p.parameterCode } },
            update: data,
            create: { serviceId, parameterCode: p.parameterCode, ...data },
        });
    }

    const count = await prisma.resultParameter.count();
    console.log(`Seeded result parameters (blood_test + echo + xray), total in DB: ${count}`);
}
