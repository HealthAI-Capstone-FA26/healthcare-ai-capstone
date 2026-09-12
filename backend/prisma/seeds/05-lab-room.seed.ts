import { PrismaService } from 'prisma/prisma.service';

/**
 * Danh mục phòng Lab (LabRoom) — bảng danh mục KHÔNG có endpoint tạo mới qua API
 * (xem LabRoomController: chỉ có GET / và các endpoint quản lý phân công kỹ thuật viên),
 * nên bắt buộc phải có sẵn qua seed trước khi hệ thống vận hành được, tương tự Department/Role.
 *
 * Các phòng này được TestCatalog.defaultLabRoomId tham chiếu tới (xem 06-test-catalog.seed.ts),
 * nên seed này PHẢI chạy trước — đã ép thứ tự qua tiền tố số "05-" (xem prisma/seed.ts).
 */
export async function seedLabRooms(prisma: PrismaService): Promise<void> {
    const labRooms = [
        {
            labRoomCode: 'HEMA',
            labRoomName: 'Phòng Xét nghiệm Huyết học',
            category: 'blood',
            location: 'Tầng 1 - Khu Xét nghiệm - Phòng 105',
            isActive: true,
        },
        {
            labRoomCode: 'BIOCHEM',
            labRoomName: 'Phòng Xét nghiệm Sinh hóa',
            category: 'biochemistry',
            location: 'Tầng 1 - Khu Xét nghiệm - Phòng 106',
            isActive: true,
        },
        {
            labRoomCode: 'MICRO',
            labRoomName: 'Phòng Vi sinh',
            category: 'microbiology',
            location: 'Tầng 1 - Khu Xét nghiệm - Phòng 107',
            isActive: true,
        },
        {
            labRoomCode: 'URINE',
            labRoomName: 'Phòng Xét nghiệm Nước tiểu',
            category: 'urine',
            location: 'Tầng 1 - Khu Xét nghiệm - Phòng 108',
            isActive: true,
        },
        {
            labRoomCode: 'IMAGING',
            labRoomName: 'Phòng Chẩn đoán hình ảnh',
            category: 'imaging',
            location: 'Tầng 2 - Khu Cận lâm sàng - Phòng 205',
            isActive: true,
        },
    ];

    for (const item of labRooms) {
        await prisma.labRoom.upsert({
            where: { labRoomCode: item.labRoomCode },
            update: {
                labRoomName: item.labRoomName,
                category: item.category,
                location: item.location,
                isActive: item.isActive,
            },
            create: item,
        });
    }

    const count = await prisma.labRoom.count();
    console.log(`Seeded lab rooms, total in DB: ${count}`);
}
