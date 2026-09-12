import { PrismaService } from 'prisma/prisma.service';

/**
 * Danh mục tham số kết quả xét nghiệm (LabResultParameter) — bảng danh mục KHÔNG có
 * endpoint tạo mới qua API (chỉ được đọc ở LabReferenceRangeService/LabResultService),
 * nên phải seed sẵn.
 *
 * QUAN TRỌNG: 20-lab-parameter-threshold.seed.ts (đổi tên từ lab-parameter-threshold.seed.ts
 * gốc — xem ghi chú trong file đó) tra cứu các bản ghi này theo `parameterCode` (GLU, HGB,
 * WBC, PLT, CREA). Nếu thiếu seed này, seed threshold sẽ chạy "thành công" nhưng KHÔNG tạo
 * được dòng nào (paramMap rỗng) — đây chính là lỗi thực tế đã phát hiện khi rà soát toàn bộ
 * chuỗi phụ thuộc LabRoom -> TestCatalog -> LabResultParameter -> LabParameterThreshold.
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

    const parameters = [
        // ===== CBC (Tổng phân tích tế bào máu) =====
        {
            testTypeId: cbcId,
            parameterCode: 'HGB',
            parameterName: 'Hemoglobin',
            loincCode: '718-7',
            unit: 'g/dL',
            dataType: 'numeric',
            displayOrder: 1,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'WBC',
            parameterName: 'Bạch cầu (WBC)',
            loincCode: '6690-2',
            unit: '10^9/L',
            dataType: 'numeric',
            displayOrder: 2,
            isActive: true,
        },
        {
            testTypeId: cbcId,
            parameterCode: 'PLT',
            parameterName: 'Tiểu cầu (Platelet)',
            loincCode: '777-3',
            unit: '10^9/L',
            dataType: 'numeric',
            displayOrder: 3,
            isActive: true,
        },
        // ===== BIOC01 (Sinh hóa máu cơ bản) =====
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
            parameterCode: 'CREA',
            parameterName: 'Creatinine',
            loincCode: '2160-0',
            unit: 'mg/dL',
            dataType: 'numeric',
            displayOrder: 2,
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
