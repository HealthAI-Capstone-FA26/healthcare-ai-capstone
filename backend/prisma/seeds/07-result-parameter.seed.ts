import { PrismaService } from 'prisma/prisma.service';

/**
 * Danh mục tham số kết quả xét nghiệm máu (ResultParameter) — CHỈ các dịch vụ blood_test trong ServiceCatalog.
 * Tất cả tham số đều dataType = 'numeric' (RuleBasedLabDetector chỉ tự đánh giá numeric/boolean).
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
    const services = await prisma.serviceCatalog.findMany({ where: { modality: 'blood_test' } });
    const serviceMap = new Map(services.map((s) => [s.serviceCode, s.serviceId]));

    const parameters = [
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
            dataType: 'numeric',
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
    console.log(`Seeded result parameters (blood test), total in DB: ${count}`);
}
