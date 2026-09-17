import { PrismaService } from 'prisma/prisma.service';

/**
 * Danh mục tham số kết quả xét nghiệm (LabResultParameter) — bảng danh mục KHÔNG có
 * endpoint tạo mới qua API (chỉ được đọc ở LabReferenceRangeService/LabResultService),
 * nên phải seed sẵn.
 *
 * QUAN TRỌNG 1: 20-lab-parameter-threshold.seed.ts tra cứu các bản ghi này để gắn ngưỡng.
 * Vì @@unique là [testTypeId, parameterCode] nên MỘT parameterCode có thể tồn tại ở nhiều
 * test type (vd. GLU ở cả máu lẫn nước tiểu). File threshold BẮT BUỘC phải tra theo CẶP
 * (testTypeId, parameterCode) — nếu chỉ tra theo parameterCode, Map sẽ ghi đè im lặng và
 * gán nhầm ngưỡng glucose máu cho glucose niệu, dẫn tới cảnh báo lâm sàng SAI.
 * Ở đây vẫn đặt mã riêng (U_GLU, U_PH) như lớp phòng vệ thứ hai.
 *
 * QUAN TRỌNG 2: Xét nghiệm hình ảnh (XQ-NGUC) và phần kháng sinh đồ của vi sinh KHÔNG đi
 * qua LabResultValue. Theo schema, chúng lưu ở:
 *   - Kết luận đọc phim  -> LabResult.overallConclusion
 *   - Mô tả chi tiết/KSĐ -> LabResultAttachment (file PDF phiếu đọc)
 *   - Ảnh phim           -> MedicalImage (đã có FK labResultId)
 *   - Diễn giải AI       -> AiImagingAnalysis / AiImagingFinding
 * Tạo param text cho các nội dung này sẽ tạo hai nguồn sự thật cho cùng một thông tin.
 *
 * NGUỒN THAM KHẢO:
 *   - CBC + công thức bạch cầu: bộ Complete Blood Count chuẩn, mã LOINC theo loinc.org.
 *   - Sinh hóa cơ bản: Glucose / Urea (BUN) / Creatinine — Urea luôn đi kèm Creatinine để
 *     đánh giá chức năng thận (Tietz Textbook of Clinical Chemistry).
 *   - Nước tiểu: LOINC Panel 24357-6 "Urinalysis macro (dipstick) panel - Urine",
 *     bổ sung phần vi thể thực hiện khi dipstick bất thường.
 *   - Cấy phân: LOINC 625-4 "Bacteria identified in Stool by Culture".
 *
 * Phụ thuộc TestCatalog đã seed ở 06-test-catalog.seed.ts — seed này chạy SAU (tiền tố "07-").
 */
export async function seedLabResultParameters(prisma: PrismaService): Promise<void> {
    const testTypes = await prisma.testCatalog.findMany();
    const testTypeMap = new Map(testTypes.map((t) => [t.testCode, t.testTypeId]));

    const getTestTypeId = (code: string): string => {
        const id = testTypeMap.get(code);
        if (!id) {
            throw new Error(
                `Không tìm thấy TestCatalog có testCode='${code}' — hãy chắc chắn 06-test-catalog.seed.ts đã chạy trước.`,
            );
        }
        return id;
    };

    const cbcId = getTestTypeId('CBC');
    const biocId = getTestTypeId('BIOC01');
    const uriId = getTestTypeId('URI01');
    const microId = getTestTypeId('MICRO01');
    // XQ-NGUC không có LabResultParameter — xem ghi chú QUAN TRỌNG 2 ở đầu file.

    const parameters = [
        // ===== CBC — Tổng phân tích tế bào máu =====
        {
            testTypeId: cbcId,
            parameterCode: 'RBC',
            parameterName: 'Số lượng hồng cầu (RBC)',
            loincCode: '789-8',
            unit: '10^12/L',
            dataType: 'numeric',
            displayOrder: 1,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'HGB',
            parameterName: 'Hemoglobin',
            loincCode: '718-7',
            unit: 'g/dL',
            dataType: 'numeric',
            displayOrder: 2,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'HCT',
            parameterName: 'Hematocrit (dung tích hồng cầu)',
            loincCode: '4544-3',
            unit: '%',
            dataType: 'numeric',
            displayOrder: 3,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'MCV',
            parameterName: 'Thể tích trung bình hồng cầu (MCV)',
            loincCode: '787-2',
            unit: 'fL',
            dataType: 'numeric',
            displayOrder: 4,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'MCH',
            parameterName: 'Lượng Hb trung bình hồng cầu (MCH)',
            loincCode: '785-6',
            unit: 'pg',
            dataType: 'numeric',
            displayOrder: 5,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'MCHC',
            parameterName: 'Nồng độ Hb trung bình hồng cầu (MCHC)',
            loincCode: '786-4',
            unit: 'g/dL',
            dataType: 'numeric',
            displayOrder: 6,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'RDW',
            parameterName: 'Độ phân bố kích thước hồng cầu (RDW)',
            loincCode: '788-0',
            unit: '%',
            dataType: 'numeric',
            displayOrder: 7,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'WBC',
            parameterName: 'Bạch cầu (WBC)',
            loincCode: '6690-2',
            unit: '10^9/L',
            dataType: 'numeric',
            displayOrder: 8,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'NEUT',
            parameterName: 'Bạch cầu trung tính (Neutrophil %)',
            loincCode: '770-8',
            unit: '%',
            dataType: 'numeric',
            displayOrder: 9,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'LYMPH',
            parameterName: 'Bạch cầu lympho (Lymphocyte %)',
            loincCode: '736-9',
            unit: '%',
            dataType: 'numeric',
            displayOrder: 10,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'MONO',
            parameterName: 'Bạch cầu mono (Monocyte %)',
            loincCode: '5905-5',
            unit: '%',
            dataType: 'numeric',
            displayOrder: 11,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'EOS',
            parameterName: 'Bạch cầu ái toan (Eosinophil %)',
            loincCode: '713-8',
            unit: '%',
            dataType: 'numeric',
            displayOrder: 12,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'BASO',
            parameterName: 'Bạch cầu ái kiềm (Basophil %)',
            loincCode: '706-2',
            unit: '%',
            dataType: 'numeric',
            displayOrder: 13,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'PLT',
            parameterName: 'Tiểu cầu (Platelet)',
            loincCode: '777-3',
            unit: '10^9/L',
            dataType: 'numeric',
            displayOrder: 14,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'MPV',
            parameterName: 'Thể tích trung bình tiểu cầu (MPV)',
            loincCode: '776-5',
            unit: 'fL',
            dataType: 'numeric',
            displayOrder: 15,
            isActive: true,
        },

        // ===== BIOC01 — Sinh hóa máu cơ bản =====
        {
            testTypeId: biocId,
            parameterCode: 'GLU',
            parameterName: 'Glucose (đói)',
            loincCode: '2345-7',
            unit: 'mg/dL',
            dataType: 'numeric',
            displayOrder: 1,
            isActive: true,
        },
        {
            testTypeId: biocId,
            parameterCode: 'URE',
            parameterName: 'Urea (BUN)',
            loincCode: '3094-0',
            unit: 'mg/dL',
            dataType: 'numeric',
            displayOrder: 2,
            isActive: true,
        },
        {
            testTypeId: biocId,
            parameterCode: 'CREA',
            parameterName: 'Creatinine',
            loincCode: '2160-0',
            unit: 'mg/dL',
            dataType: 'numeric',
            displayOrder: 3,
            isActive: true,
        },

        // ===== URI01 — Tổng phân tích nước tiểu (dipstick) =====
        {
            testTypeId: uriId,
            parameterCode: 'U_SG',
            parameterName: 'Tỷ trọng (Specific Gravity)',
            loincCode: '5811-5',
            unit: null,
            dataType: 'numeric',
            displayOrder: 1,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_PH',
            parameterName: 'Độ pH nước tiểu',
            loincCode: '5803-2',
            unit: null,
            dataType: 'numeric',
            displayOrder: 2,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_PRO',
            parameterName: 'Protein niệu',
            loincCode: '5804-0',
            unit: null,
            dataType: 'positive_negative',
            displayOrder: 3,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_GLU',
            parameterName: 'Glucose niệu',
            loincCode: '5792-7',
            unit: null,
            dataType: 'positive_negative',
            displayOrder: 4,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_KET',
            parameterName: 'Thể ceton (Ketone)',
            loincCode: '5797-6',
            unit: null,
            dataType: 'positive_negative',
            displayOrder: 5,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_BLD',
            parameterName: 'Hồng cầu/Máu (Blood)',
            loincCode: '5794-3',
            unit: null,
            dataType: 'positive_negative',
            displayOrder: 6,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_BIL',
            parameterName: 'Bilirubin niệu',
            loincCode: '5770-3',
            unit: null,
            dataType: 'positive_negative',
            displayOrder: 7,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_URO',
            parameterName: 'Urobilinogen',
            loincCode: '5793-5',
            unit: null,
            dataType: 'positive_negative',
            displayOrder: 8,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_NIT',
            parameterName: 'Nitrite',
            loincCode: '5802-4',
            unit: null,
            dataType: 'positive_negative',
            displayOrder: 9,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_LEU',
            parameterName: 'Bạch cầu niệu (Leukocyte Esterase)',
            loincCode: '5799-2',
            unit: null,
            dataType: 'positive_negative',
            displayOrder: 10,
            isActive: true,
        },

        // ===== URI01 — phần vi thể (chỉ làm khi dipstick bất thường) =====
        // loincCode để null: các mã vi thể chưa được xác minh chắc chắn, cần tra lại
        // trên https://loinc.org trước khi đưa vào production.
        {
            testTypeId: uriId,
            parameterCode: 'U_RBC_MIC',
            parameterName: 'Hồng cầu (vi thể)',
            loincCode: null,
            unit: '/HPF',
            dataType: 'numeric',
            displayOrder: 11,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_WBC_MIC',
            parameterName: 'Bạch cầu (vi thể)',
            loincCode: null,
            unit: '/HPF',
            dataType: 'numeric',
            displayOrder: 12,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_EPI',
            parameterName: 'Tế bào biểu mô',
            loincCode: null,
            unit: null,
            dataType: 'positive_negative',
            displayOrder: 13,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_CAST',
            parameterName: 'Trụ niệu (Casts)',
            loincCode: null,
            unit: null,
            dataType: 'positive_negative',
            displayOrder: 14,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_CRYST',
            parameterName: 'Tinh thể (Crystals)',
            loincCode: null,
            unit: null,
            dataType: 'positive_negative',
            displayOrder: 15,
            isActive: true,
        },
        {
            testTypeId: uriId,
            parameterCode: 'U_BACT',
            parameterName: 'Vi khuẩn (vi thể)',
            loincCode: null,
            unit: null,
            dataType: 'positive_negative',
            displayOrder: 16,
            isActive: true,
        },

        // ===== MICRO01 — Cấy phân tìm vi khuẩn gây bệnh =====
        // Chỉ 1 param định tính. Tên tác nhân phân lập được và bảng kháng sinh đồ lưu ở
        // LabResult.overallConclusion + LabResultAttachment (KSĐ là bảng nhiều dòng,
        // không nhồi vừa valueText).
        {
            testTypeId: microId,
            parameterCode: 'STOOL_CULT',
            parameterName: 'Nuôi cấy phân (mọc/không mọc vi khuẩn gây bệnh)',
            loincCode: '625-4',
            unit: null,
            dataType: 'positive_negative',
            displayOrder: 1,
            isActive: true,
        },
    ];

    for (const item of parameters) {
        await prisma.labResultParameter.upsert({
            where: {
                testTypeId_parameterCode: {
                    testTypeId: item.testTypeId,
                    parameterCode: item.parameterCode,
                },
            },
            update: {
                parameterName: item.parameterName,
                loincCode: item.loincCode,
                unit: item.unit,
                dataType: item.dataType,
                displayOrder: item.displayOrder,
                isActive: item.isActive,
            },
            create: item,
        });
    }

    const count = await prisma.labResultParameter.count();
    console.log(`Seeded lab result parameters, total in DB: ${count}`);
}