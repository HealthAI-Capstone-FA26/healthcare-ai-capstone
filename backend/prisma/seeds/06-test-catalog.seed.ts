import { PrismaService } from 'prisma/prisma.service';

/**
 * Danh mục xét nghiệm/chỉ định (TestCatalog) — bảng danh mục KHÔNG có module/endpoint tạo mới
 * qua API (chỉ được đọc ở TestOrderService.create và TestRecommendationService), nên cũng
 * phải seed sẵn giống LabRoom/Department.
 *
 * Phụ thuộc LabRoom (defaultLabRoomId) đã seed ở 05-lab-room.seed.ts — seed này chạy SAU
 * (tiền tố "06-"). LabResultParameter (07-lab-result-parameter.seed.ts) và
 * DiagnosisTestRecommendation (70-diagnosis-test-recommendation.seed.ts) lại phụ thuộc NGƯỢC
 * vào danh mục này, nên cả hai đều được xếp chạy SAU seed này.
 */
export async function seedTestCatalog(prisma: PrismaService): Promise<void> {
    const labRooms = await prisma.labRoom.findMany();
    const labRoomMap = new Map(labRooms.map((r) => [r.labRoomCode, r.labRoomId]));

    const getLabRoomId = (code: string): string => {
        const id = labRoomMap.get(code);
        if (!id) {
            throw new Error(
                `Không tìm thấy LabRoom có labRoomCode='${code}' — hãy chắc chắn lab-room.seed.ts đã chạy trước.`,
            );
        }
        return id;
    };

    const testCatalogs = [
        {
            testCode: 'CBC',
            testName: 'Tổng phân tích tế bào máu (CBC)',
            category: 'blood',
            specimenType: 'Máu tĩnh mạch (ống chống đông EDTA)',
            price: 150000,
            turnaroundTimeHours: 2,
            defaultLabRoomId: getLabRoomId('HEMA'),
            isActive: true,
        },
        {
            testCode: 'BIOC01',
            testName: 'Sinh hóa máu cơ bản (Glucose, Creatinine)',
            category: 'biochemistry',
            specimenType: 'Máu tĩnh mạch (ống không chống đông)',
            price: 180000,
            turnaroundTimeHours: 3,
            defaultLabRoomId: getLabRoomId('BIOCHEM'),
            isActive: true,
        },
        {
            testCode: 'URI01',
            testName: 'Tổng phân tích nước tiểu',
            category: 'urine',
            specimenType: 'Nước tiểu giữa dòng',
            price: 60000,
            turnaroundTimeHours: 1,
            defaultLabRoomId: getLabRoomId('URINE'),
            isActive: true,
        },
        {
            testCode: 'MICRO01',
            testName: 'Cấy phân tìm vi khuẩn gây bệnh',
            category: 'microbiology',
            specimenType: 'Mẫu phân',
            price: 250000,
            turnaroundTimeHours: 72,
            defaultLabRoomId: getLabRoomId('MICRO'),
            isActive: true,
        },
        {
            testCode: 'XQ-NGUC',
            testName: 'Chụp X-quang ngực thẳng',
            category: 'imaging',
            specimenType: null,
            price: 120000,
            turnaroundTimeHours: 1,
            defaultLabRoomId: getLabRoomId('IMAGING'),
            isActive: true,
        },
    ];

    for (const item of testCatalogs) {
        await prisma.testCatalog.upsert({
            where: { testCode: item.testCode },
            update: {
                testName: item.testName,
                category: item.category,
                specimenType: item.specimenType,
                price: item.price,
                turnaroundTimeHours: item.turnaroundTimeHours,
                defaultLabRoomId: item.defaultLabRoomId,
                isActive: item.isActive,
            },
            create: item,
        });
    }

    const count = await prisma.testCatalog.count();
    console.log(`Seeded test catalog, total in DB: ${count}`);
}
