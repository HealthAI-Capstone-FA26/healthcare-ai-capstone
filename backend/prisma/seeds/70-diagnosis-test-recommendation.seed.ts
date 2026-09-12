import { PrismaService } from 'prisma/prisma.service';

/**
 * Gợi ý chỉ định xét nghiệm theo chẩn đoán ICD-10 (DiagnosisTestRecommendation) — bảng danh
 * mục KHÔNG có endpoint tạo mới qua API. Theo đúng comment nghiệp vụ trong
 * TestRecommendationService ("tra bảng DiagnosisTestRecommendation đã seed sẵn theo mã
 * ICD-10 — đây là logic NGHIỆP VỤ THẬT, KHÔNG phải phần AI"), bảng này BẮT BUỘC phải seed sẵn
 * để tính năng gợi ý chỉ định hoạt động, nhưng trước đây chưa có seed nào cho bảng này.
 *
 * Dữ liệu dưới đây chỉ là TẬP MẪU minh hoạ cho một vài chẩn đoán phổ biến, ánh xạ tới danh mục
 * xét nghiệm mẫu đã seed ở 06-test-catalog.seed.ts. Đội ngũ lâm sàng cần rà soát và mở rộng
 * thêm ánh xạ cho đầy đủ các mã ICD-10 khác trước khi dùng ở production.
 *
 * Phụ thuộc: Icd10Code (10-icd10.seed.ts) và TestCatalog (06-test-catalog.seed.ts).
 * Seed này dùng tiền tố "70-" để đảm bảo chạy SAU cả hai (xem cơ chế sort theo tiền tố
 * số trong prisma/seed.ts).
 *
 * LƯU Ý: model DiagnosisTestRecommendation KHÔNG có ràng buộc @@unique nào ngoài khoá chính,
 * nên seed này tự kiểm tra trùng lặp theo cặp (icd10Code, testTypeId) trước khi tạo, để có thể
 * chạy lại nhiều lần (idempotent) mà không tạo trùng dòng.
 */
export async function seedDiagnosisTestRecommendations(prisma: PrismaService): Promise<void> {
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
    const xqId = getTestTypeId('XQ-NGUC');

    interface RecommendationSeed {
        icd10Code: string;
        testTypeId: string;
        priority: 'recommended' | 'optional';
        rationale: string;
    }

    const recommendations: RecommendationSeed[] = [
        // R50.9 - Sốt chưa rõ nguyên nhân
        { icd10Code: 'R50.9', testTypeId: cbcId, priority: 'recommended', rationale: 'Đánh giá tình trạng nhiễm trùng qua số lượng bạch cầu' },
        { icd10Code: 'R50.9', testTypeId: uriId, priority: 'optional', rationale: 'Loại trừ nhiễm trùng đường tiết niệu là nguyên nhân gây sốt' },

        // J18.9 - Viêm phổi chưa xác định tác nhân
        { icd10Code: 'J18.9', testTypeId: cbcId, priority: 'recommended', rationale: 'Đánh giá mức độ nhiễm trùng/viêm qua bạch cầu' },
        { icd10Code: 'J18.9', testTypeId: xqId, priority: 'recommended', rationale: 'Xác nhận tổn thương nhu mô phổi trên X-quang ngực' },

        // E11.9 - Đái tháo đường type 2 không biến chứng
        { icd10Code: 'E11.9', testTypeId: biocId, priority: 'recommended', rationale: 'Theo dõi chỉ số đường huyết (Glucose)' },

        // N18.9 - Bệnh thận mạn chưa xác định giai đoạn
        { icd10Code: 'N18.9', testTypeId: biocId, priority: 'recommended', rationale: 'Theo dõi chức năng thận qua chỉ số Creatinine' },

        // R10.9 - Đau bụng chưa xác định
        { icd10Code: 'R10.9', testTypeId: cbcId, priority: 'optional', rationale: 'Tầm soát dấu hiệu nhiễm trùng/viêm ổ bụng' },
        { icd10Code: 'R10.9', testTypeId: uriId, priority: 'optional', rationale: 'Loại trừ nguyên nhân từ đường tiết niệu (VD: sỏi, nhiễm trùng)' },
    ];

    let createdCount = 0;
    let skippedCount = 0;

    for (const item of recommendations) {
        const icd10 = await prisma.icd10Code.findUnique({ where: { icd10Code: item.icd10Code } });
        if (!icd10) {
            console.warn(
                `Bỏ qua gợi ý ${item.icd10Code} -> ${item.testTypeId}: không tìm thấy mã ICD-10 này (kiểm tra lại icd10.seed.ts).`,
            );
            continue;
        }

        const existing = await prisma.diagnosisTestRecommendation.findFirst({
            where: { icd10Code: item.icd10Code, testTypeId: item.testTypeId },
        });

        if (existing) {
            await prisma.diagnosisTestRecommendation.update({
                where: { recommendationId: existing.recommendationId },
                data: {
                    priority: item.priority,
                    rationale: item.rationale,
                    isActive: true,
                },
            });
            skippedCount++;
            continue;
        }

        await prisma.diagnosisTestRecommendation.create({
            data: {
                icd10Code: item.icd10Code,
                testTypeId: item.testTypeId,
                priority: item.priority,
                rationale: item.rationale,
                isActive: true,
            },
        });
        createdCount++;
    }

    const count = await prisma.diagnosisTestRecommendation.count();
    console.log(
        `Seeded diagnosis test recommendations: ${createdCount} tạo mới, ${skippedCount} cập nhật, total in DB: ${count}`,
    );
}
