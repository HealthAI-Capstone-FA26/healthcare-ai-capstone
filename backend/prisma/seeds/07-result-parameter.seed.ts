import { Prisma } from '@prisma/client';
import { PrismaService } from 'prisma/prisma.service';


/**
 * Danh mục tham số kết quả (ResultParameter) cho:
 *   - blood_test : dịch vụ duy nhất 'BLOODFULL' (Full panel) — 27 tham số dataType = 'numeric' (CBC 15 · sinh hóa 3 · điện giải 2
 *                  · mỡ máu 4 · dấu ấn tim 3). displayOrder 1–27 theo đúng thứ tự nhóm; chưa có cột parameterGroup nên UI nhóm theo displayOrder.
 *   - echo (TTE) : chỉ số siêu âm tim có cấu trúc — numeric (LVEF, LVIDD, LA_DIAM), enum (mức độ hở/hẹp van),
 *                  boolean (RWMA, tràn dịch màng ngoài tim).
 *   - xray (CXRPA): chỉ số X-quang ngực — numeric (CTR), enum (ứ huyết phổi, tràn dịch màng phổi), boolean (đông đặc/thâm nhiễm).
 * Echo/X-quang là 'image_report': nhập kết quả vẫn BẮT BUỘC có findings/kết luận; các tham số này là phần ĐO ĐẠC có cấu trúc
 * (tuỳ chọn khi nhập) để theo dõi xu hướng và cảnh báo rule-based.
 *
 * RuleBasedLabDetector: numeric -> so ngưỡng (20-...) · boolean -> true = bất thường (mức 'high') · enum/text -> KHÔNG tự đánh giá.
 * Vì vậy boolean ở đây đều mô tả "CÓ dấu hiệu bệnh lý".
 *
 * Mã LOINC của các chỉ số echo/X-quang để trống (null) — chưa xác nhận; cần bổ sung nếu liên thông HIS/FHIR.
 *
 * QUAN TRỌNG: @@unique là [serviceId, parameterCode] -> tra cứu BẮT BUỘC theo cặp (serviceCode, parameterCode),
 * không bao giờ chỉ theo parameterCode (xem 20-result-parameter-threshold.seed.ts).
 *
 * ── Nguồn chuẩn cho từng thuộc tính của BLOODFULL (kiểm tra lần cuối 26/11/2026) ───────────────────
 * Mỗi tham số máu là một xét nghiệm có mã LOINC chính thức; trang định nghĩa gốc (tên đầy đủ, hệ mẫu, phương pháp, đơn vị mẫu)
 * nằm trên LOINC.org (Regenstrief Institute), theo dạng https://loinc.org/<mã>:
 *     parameterCode  LOINC    liên kết
 *     RBC      789-8    https://loinc.org/789-8
 *     HGB      718-7    https://loinc.org/718-7
 *     HCT      4544-3   https://loinc.org/4544-3
 *     MCV      787-2    https://loinc.org/787-2
 *     MCH      785-6    https://loinc.org/785-6
 *     MCHC     786-4    https://loinc.org/786-4
 *     RDW      788-0    https://loinc.org/788-0
 *     WBC      6690-2   https://loinc.org/6690-2
 *     NEUT     770-8    https://loinc.org/770-8
 *     LYMPH    736-9    https://loinc.org/736-9
 *     MONO     5905-5   https://loinc.org/5905-5
 *     EOS      713-8    https://loinc.org/713-8
 *     BASO     706-2    https://loinc.org/706-2
 *     PLT      777-3    https://loinc.org/777-3
 *     MPV      32623-1  https://loinc.org/32623-1
 *     GLU      2345-7   https://loinc.org/2345-7
 *     URE      3094-0   https://loinc.org/3094-0
 *     CREA     2160-0   https://loinc.org/2160-0
 *     NA       2951-2   https://loinc.org/2951-2
 *     K        2823-3   https://loinc.org/2823-3
 *     TC       2093-3   https://loinc.org/2093-3
 *     LDLC     13457-7  https://loinc.org/13457-7
 *     HDLC     2085-9   https://loinc.org/2085-9
 *     TG       2571-8   https://loinc.org/2571-8
 *     HSTNT    67151-1  https://loinc.org/67151-1
 *     CKMB     13969-1  https://loinc.org/13969-1
 *     NTPROBNP 33762-6  https://loinc.org/33762-6
 *
 * Đối chiếu chéo mã với danh mục xét nghiệm của phòng xét nghiệm học thuật (cùng mã LOINC kết quả):
 *   - 15 chỉ số CBC (RBC, HGB, HCT, MCV, MCH, MCHC, RDW, WBC, NEUT, LYMPH, MONO, EOS, BASO, PLT, MPV): panel CBC chính thức trên
 *     LOINC.org https://cdn.loinc.org/57021-8/panel ; Mayo Clinic Laboratories https://www.mayocliniclabs.com/test-catalog/overview/9109
 *   - GLU, URE, CREA, NA, K: Mayo Clinic Laboratories, Basic Metabolic Panel (LOINC panel 24321-2)
 *     https://www.mayocliniclabs.com/test-catalog/overview/113630
 *   - HSTNT 67151-1: Mayo Clinic Laboratories, Troponin T 5th generation https://www.mayocliniclabs.com/test-catalog/overview/65832
 *   - NTPROBNP: Mayo Clinic Laboratories dùng 83107-3 cho mẫu huyết thanh (https://www.mayocliniclabs.com/test-catalog/overview/615897);
 *     33762-6 là mã tổng quát huyết thanh/huyết tương, dùng ở đây vì BLOODFULL không ràng buộc loại mẫu cho riêng chỉ số này.
 *   - CKMB 13969-1: University of Michigan Health, Michigan Medicine Laboratories https://mlabs.umich.edu/tests/creatine-kinase-total-and-mb-isoenzyme
 *   - MPV: dùng 32623-1 (phương pháp Automated count, thuộc CBC panel); KHÔNG dùng 776-5 (phương pháp Rees-Ecker, thủ công).
 *   - LDLC 13457-7 là LDL TÍNH TOÁN (công thức), không tính được khi TG > 800 mg/dL; nếu analyzer đo LDL trực tiếp thì đổi sang 18262-6.
 *     Nguồn: Mayo Clinic Laboratories CLDL1 https://www.mayocliniclabs.com/test-catalog/overview/617023 (LOINC 13457-7; tính toán không áp dụng khi TG > 800 mg/dL).
 *   - GLU 2345-7 là glucose huyết thanh/huyết tương nói chung; 'đói' là điều kiện lấy mẫu (xem 06-), không nằm trong mã.
 * Ngưỡng cảnh báo và nguồn trích dẫn của từng chỉ số nằm ở 20-result-parameter-threshold.seed.ts (cột sourceReference của mỗi dòng
 * có URL trực tiếp tới tài liệu gốc).
 *
 * Đơn vị trong cột `unit` là chuỗi hiển thị. Nếu liên thông HIS/FHIR thì dùng ký hiệu UCUM (vd 10*12/L, 10*9/L), không dùng 10^12/L.
 * hs-Troponin T, CK-MB, NT-proBNP và LDL-C phụ thuộc phương pháp/hãng máy -> cần phòng Lab xác nhận lại theo analyzer thực tế.
 *
 * Phụ thuộc ServiceCatalog (06-service-catalog.seed.ts) — seed này chạy SAU.
 */
export async function seedResultParameters(prisma: PrismaService): Promise<void> {
    const services = await prisma.serviceCatalog.findMany({ where: { modality: { in: ['blood_test', 'echo', 'xray'] } } });
    const legacyBloodCodes = ['CBC', 'BIOC01', 'ELEC01', 'LIPID01', 'HSTNT', 'CKMB', 'NTPROBNP'];
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
        { serviceCode: 'BLOODFULL', parameterCode: 'RBC', parameterName: 'Số lượng hồng cầu (RBC)', loincCode: '789-8', unit: '10^12/L', displayOrder: 1 },
        { serviceCode: 'BLOODFULL', parameterCode: 'HGB', parameterName: 'Hemoglobin', loincCode: '718-7', unit: 'g/dL', displayOrder: 2 },
        { serviceCode: 'BLOODFULL', parameterCode: 'HCT', parameterName: 'Hematocrit (dung tích hồng cầu)', loincCode: '4544-3', unit: '%', displayOrder: 3 },
        { serviceCode: 'BLOODFULL', parameterCode: 'MCV', parameterName: 'Thể tích trung bình hồng cầu (MCV)', loincCode: '787-2', unit: 'fL', displayOrder: 4 },
        { serviceCode: 'BLOODFULL', parameterCode: 'MCH', parameterName: 'Lượng Hb trung bình hồng cầu (MCH)', loincCode: '785-6', unit: 'pg', displayOrder: 5 },
        { serviceCode: 'BLOODFULL', parameterCode: 'MCHC', parameterName: 'Nồng độ Hb trung bình hồng cầu (MCHC)', loincCode: '786-4', unit: 'g/dL', displayOrder: 6 },
        { serviceCode: 'BLOODFULL', parameterCode: 'RDW', parameterName: 'Độ phân bố kích thước hồng cầu (RDW)', loincCode: '788-0', unit: '%', displayOrder: 7 },
        { serviceCode: 'BLOODFULL', parameterCode: 'WBC', parameterName: 'Bạch cầu (WBC)', loincCode: '6690-2', unit: '10^9/L', displayOrder: 8 },
        { serviceCode: 'BLOODFULL', parameterCode: 'NEUT', parameterName: 'Bạch cầu trung tính (Neutrophil %)', loincCode: '770-8', unit: '%', displayOrder: 9 },
        { serviceCode: 'BLOODFULL', parameterCode: 'LYMPH', parameterName: 'Bạch cầu lympho (Lymphocyte %)', loincCode: '736-9', unit: '%', displayOrder: 10 },
        { serviceCode: 'BLOODFULL', parameterCode: 'MONO', parameterName: 'Bạch cầu mono (Monocyte %)', loincCode: '5905-5', unit: '%', displayOrder: 11 },
        { serviceCode: 'BLOODFULL', parameterCode: 'EOS', parameterName: 'Bạch cầu ái toan (Eosinophil %)', loincCode: '713-8', unit: '%', displayOrder: 12 },
        { serviceCode: 'BLOODFULL', parameterCode: 'BASO', parameterName: 'Bạch cầu ái kiềm (Basophil %)', loincCode: '706-2', unit: '%', displayOrder: 13 },
        { serviceCode: 'BLOODFULL', parameterCode: 'PLT', parameterName: 'Tiểu cầu (Platelet)', loincCode: '777-3', unit: '10^9/L', displayOrder: 14 },
        { serviceCode: 'BLOODFULL', parameterCode: 'MPV', parameterName: 'Thể tích trung bình tiểu cầu (MPV)', loincCode: '32623-1', unit: 'fL', displayOrder: 15 },
        { serviceCode: 'BLOODFULL', parameterCode: 'GLU', parameterName: 'Glucose (đói)', loincCode: '2345-7', unit: 'mg/dL', displayOrder: 16 },
        { serviceCode: 'BLOODFULL', parameterCode: 'URE', parameterName: 'Urea (BUN)', loincCode: '3094-0', unit: 'mg/dL', displayOrder: 17 },
        { serviceCode: 'BLOODFULL', parameterCode: 'CREA', parameterName: 'Creatinine', loincCode: '2160-0', unit: 'mg/dL', displayOrder: 18 },
        { serviceCode: 'BLOODFULL', parameterCode: 'EGFR', parameterName: 'eGFR (CKD-EPI 2021, tính toán)', loincCode: '98979-8', unit: 'mL/min/1.73m²', displayOrder: 19 },
        { serviceCode: 'BLOODFULL', parameterCode: 'CA', parameterName: 'Calcium toàn phần', loincCode: '17861-6', unit: 'mg/dL', displayOrder: 20 },
        { serviceCode: 'BLOODFULL', parameterCode: 'NA', parameterName: 'Natri (Na+)', loincCode: '2951-2', unit: 'mmol/L', displayOrder: 21 },
        { serviceCode: 'BLOODFULL', parameterCode: 'K', parameterName: 'Kali (K+)', loincCode: '2823-3', unit: 'mmol/L', displayOrder: 22 },
        { serviceCode: 'BLOODFULL', parameterCode: 'CL', parameterName: 'Clorua (Cl-)', loincCode: '2075-0', unit: 'mmol/L', displayOrder: 23 },
        { serviceCode: 'BLOODFULL', parameterCode: 'HCO3', parameterName: 'Bicarbonate (HCO3-)', loincCode: '1963-8', unit: 'mmol/L', displayOrder: 24 },
        { serviceCode: 'BLOODFULL', parameterCode: 'AGAP', parameterName: 'Anion gap (tính toán)', loincCode: '33037-3', unit: 'mmol/L', displayOrder: 25 },
        { serviceCode: 'BLOODFULL', parameterCode: 'TC', parameterName: 'Cholesterol toàn phần (Total Cholesterol)', loincCode: '2093-3', unit: 'mg/dL', displayOrder: 26 },
        { serviceCode: 'BLOODFULL', parameterCode: 'LDLC', parameterName: 'LDL-Cholesterol (tính toán)', loincCode: '13457-7', unit: 'mg/dL', displayOrder: 27 },
        { serviceCode: 'BLOODFULL', parameterCode: 'HDLC', parameterName: 'HDL-Cholesterol', loincCode: '2085-9', unit: 'mg/dL', displayOrder: 28 },
        { serviceCode: 'BLOODFULL', parameterCode: 'TG', parameterName: 'Triglyceride', loincCode: '2571-8', unit: 'mg/dL', displayOrder: 29 },
        { serviceCode: 'BLOODFULL', parameterCode: 'HSTNT', parameterName: 'hs-Troponin T', loincCode: '67151-1', unit: 'ng/L', displayOrder: 30 },
        { serviceCode: 'BLOODFULL', parameterCode: 'CKMB', parameterName: 'CK-MB (mass)', loincCode: '13969-1', unit: 'ng/mL', displayOrder: 31 },
        { serviceCode: 'BLOODFULL', parameterCode: 'NTPROBNP', parameterName: 'NT-proBNP', loincCode: '33762-6', unit: 'pg/mL', displayOrder: 32 },
        { serviceCode: 'BLOODFULL', parameterCode: 'NEUT_ABS', parameterName: 'Bạch cầu trung tính (tuyệt đối)', loincCode: '751-8', unit: '10^9/L', displayOrder: 33 },
        { serviceCode: 'BLOODFULL', parameterCode: 'LYMPH_ABS', parameterName: 'Bạch cầu Lympho (tuyệt đối)', loincCode: '731-0', unit: '10^9/L', displayOrder: 34 },
        { serviceCode: 'BLOODFULL', parameterCode: 'MONO_ABS', parameterName: 'Bạch cầu Mono (tuyệt đối)', loincCode: '742-7', unit: '10^9/L', displayOrder: 35 },
        { serviceCode: 'BLOODFULL', parameterCode: 'EOS_ABS', parameterName: 'Bạch cầu ái toan (tuyệt đối)', loincCode: '711-2', unit: '10^9/L', displayOrder: 36 },
        { serviceCode: 'BLOODFULL', parameterCode: 'BASO_ABS', parameterName: 'Bạch cầu ái kiềm (tuyệt đối)', loincCode: '704-7', unit: '10^9/L', displayOrder: 37 },

        // ── TTE — Siêu âm tim qua thành ngực ──
        { serviceCode: 'TTE', parameterCode: 'LVEF', parameterName: 'Phân suất tống máu thất trái (LVEF)', loincCode: null, unit: '%', displayOrder: 1 },
        { serviceCode: 'TTE', parameterCode: 'LVIDD', parameterName: 'Đường kính thất trái cuối tâm trương (LVIDd)', loincCode: null, unit: 'mm', displayOrder: 2 },
        { serviceCode: 'TTE', parameterCode: 'LA_DIAM', parameterName: 'Đường kính nhĩ trái (trục dọc cạnh ức)', loincCode: null, unit: 'mm', displayOrder: 3 },
        { serviceCode: 'TTE', parameterCode: 'LAVI', parameterName: 'Chỉ số thể tích nhĩ trái (LAVI)', loincCode: null, unit: 'mL/m²', displayOrder: 4 },
        { serviceCode: 'TTE', parameterCode: 'IVSD', parameterName: 'Bề dày vách liên thất cuối tâm trương (IVSd)', loincCode: null, unit: 'mm', displayOrder: 5 },
        { serviceCode: 'TTE', parameterCode: 'LVMI', parameterName: 'Chỉ số khối cơ thất trái (LVMI)', loincCode: null, unit: 'g/m²', displayOrder: 6 },
        { serviceCode: 'TTE', parameterCode: 'TAPSE', parameterName: 'Biên độ dịch chuyển vòng van ba lá thì tâm thu (TAPSE)', loincCode: null, unit: 'mm', displayOrder: 7 },
        { serviceCode: 'TTE', parameterCode: 'RVD1', parameterName: 'Đường kính đáy thất phải (RVD1)', loincCode: null, unit: 'mm', displayOrder: 8 },

        // ── CXRPA — X-quang ngực thẳng ──
        { serviceCode: 'CXRPA', parameterCode: 'CTR', parameterName: 'Chỉ số tim–ngực (CTR)', loincCode: null, unit: '%', displayOrder: 1 },
        { serviceCode: 'CXRPA', parameterCode: 'PULM_CONGESTION', parameterName: 'Ứ huyết phổi / phù phổi', loincCode: null, unit: null, displayOrder: 2, dataType: 'enum', allowedValues: grade4 },
        {
            serviceCode: 'CXRPA', parameterCode: 'PLEURAL_EFF', parameterName: 'Tràn dịch màng phổi', loincCode: null, unit: null, displayOrder: 3, dataType: 'enum', allowedValues: [
                { value: 'none', label: 'Không' },
                { value: 'left', label: 'Bên trái' },
                { value: 'right', label: 'Bên phải' },
                { value: 'bilateral', label: 'Hai bên' },
            ]
        },
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

    // Vô hiệu hóa tham số của 7 gói máu cũ (nếu DB đã seed trước đó và 06- chỉ đặt isActive=false vì còn lịch sử).
    // Không xóa: ResultValue.parameterId là FK. Gói cũ đã bị 06- xóa hẳn thì không còn dòng nào để cập nhật.
    await prisma.resultParameter.updateMany({
        where: { service: { serviceCode: { in: legacyBloodCodes } }, isActive: true },
        data: { isActive: false },
    });

    const count = await prisma.resultParameter.count();
    console.log(`Seeded result parameters (blood_test + echo + xray), total in DB: ${count}`);
}