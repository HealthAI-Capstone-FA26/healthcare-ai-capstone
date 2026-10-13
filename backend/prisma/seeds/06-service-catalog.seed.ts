import { PrismaService } from 'prisma/prisma.service';

/**
 * Danh mục dịch vụ cận lâm sàng (ServiceCatalog) — CHỈ các xét nghiệm máu (modality = 'blood_test'),
 * resultKind = 'parametric' (kết quả là các chỉ số đo đạc -> ResultValue).
 *
 * Bám theo proposal (SE02): "blood tests for cardiac biomarkers and lipid profiles", cộng thêm các xét nghiệm
 * nền thường đi kèm khi khám tim mạch (công thức máu, sinh hóa cơ bản, điện giải).
 *
 * ⚠️ `price` là GIÁ MẪU (VND) — phải thay bằng bảng giá thật của phòng khám trước khi dùng cho thanh toán (SE03).
 * ⚠️ `turnaroundMins`, `preparationNote` là giá trị tham khảo, cần phòng Lab xác nhận.
 *
 * Phụ thuộc DiagnosticRoom (05-diagnostic-room.seed.ts) — seed này chạy SAU.
 * ResultParameter (07-) và ResultParameterThreshold (20-) tham chiếu ngược lại danh mục này theo serviceCode.
 */
export async function seedServiceCatalog(prisma: PrismaService): Promise<void> {
    const room = await prisma.diagnosticRoom.findUnique({ where: { diagnosticRoomCode: 'BLOOD-LAB' } });
    if (!room) {
        throw new Error(
            "Không tìm thấy DiagnosticRoom 'BLOOD-LAB' — hãy chắc chắn 05-diagnostic-room.seed.ts đã chạy trước.",
        );
    }

    const services = [
        {
            serviceCode: 'CBC',
            serviceName: 'Tổng phân tích tế bào máu (CBC)',
            panelGroup: 'hematology',
            specimenType: 'whole_blood',
            requiresFasting: false,
            preparationNote: null,
            price: 150000,
            turnaroundMins: 120,
        },
        {
            serviceCode: 'BIOC01',
            serviceName: 'Sinh hóa máu cơ bản (Glucose đói, Urea, Creatinine)',
            panelGroup: 'basic_chemistry',
            specimenType: 'serum',
            requiresFasting: true,
            preparationNote: 'Nhịn ăn 8–12 giờ trước khi lấy máu (chỉ uống nước lọc).',
            price: 180000,
            turnaroundMins: 180,
        },
        {
            serviceCode: 'ELEC01',
            serviceName: 'Điện giải đồ (Na+, K+)',
            panelGroup: 'electrolytes',
            specimenType: 'serum',
            requiresFasting: false,
            preparationNote: null,
            price: 100000,
            turnaroundMins: 120,
        },
        {
            serviceCode: 'LIPID01',
            serviceName: 'Bộ mỡ máu (Total Cholesterol, LDL-C, HDL-C, Triglyceride)',
            panelGroup: 'lipid_profile',
            specimenType: 'serum',
            requiresFasting: true,
            preparationNote: 'Nhịn ăn 9–12 giờ trước khi lấy máu; tránh rượu bia 24 giờ trước.',
            price: 200000,
            turnaroundMins: 240,
        },
        {
            serviceCode: 'HSTNT',
            serviceName: 'hs-Troponin T',
            panelGroup: 'cardiac_biomarker',
            specimenType: 'serum',
            requiresFasting: false,
            preparationNote: null,
            price: 200000,
            turnaroundMins: 60,
        },
        {
            serviceCode: 'CKMB',
            serviceName: 'CK-MB (mass)',
            panelGroup: 'cardiac_biomarker',
            specimenType: 'serum',
            requiresFasting: false,
            preparationNote: null,
            price: 120000,
            turnaroundMins: 90,
        },
        {
            serviceCode: 'NTPROBNP',
            serviceName: 'NT-proBNP',
            panelGroup: 'cardiac_biomarker',
            specimenType: 'serum',
            requiresFasting: false,
            preparationNote: null,
            price: 450000,
            turnaroundMins: 120,
        },
    ];

    for (const s of services) {
        const data = {
            serviceName: s.serviceName,
            modality: 'blood_test',
            panelGroup: s.panelGroup,
            resultKind: 'parametric',
            specimenType: s.specimenType,
            requiresFasting: s.requiresFasting,
            preparationNote: s.preparationNote,
            price: s.price,
            turnaroundMins: s.turnaroundMins,
            defaultRoomId: room.diagnosticRoomId,
            isActive: true,
        };
        await prisma.serviceCatalog.upsert({
            where: { serviceCode: s.serviceCode },
            update: data,
            create: { serviceCode: s.serviceCode, ...data },
        });
    }

    const count = await prisma.serviceCatalog.count();
    console.log(`Seeded service catalog (blood test), total in DB: ${count}`);
}
