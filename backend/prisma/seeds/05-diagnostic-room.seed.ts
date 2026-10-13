import { PrismaService } from 'prisma/prisma.service';

/**
 * Danh mục phòng cận lâm sàng (DiagnosticRoom) — CHỈ giữ phòng Xét nghiệm máu (modality = 'blood_test').
 * Các phòng ECG / Siêu âm tim / X-quang chưa seed ở đây theo yêu cầu phạm vi hiện tại.
 *
 * Bảng này không có endpoint tạo mới (LabRoomService chỉ có list + phân công KTV), nên phải seed sẵn.
 * ServiceCatalog.defaultRoomId tham chiếu tới bảng này -> seed này chạy TRƯỚC 06-service-catalog.
 *
 * `location` là giá trị MẪU, cần thay bằng vị trí thật của phòng khám.
 */
export async function seedDiagnosticRooms(prisma: PrismaService): Promise<void> {
    const rooms = [
        {
            diagnosticRoomCode: 'BLOOD-LAB',
            diagnosticRoomName: 'Phòng Xét nghiệm Máu (Blood Test Lab)',
            modality: 'blood_test',
            location: 'Tầng 1 - Khu Xét nghiệm - Phòng 105',
            isActive: true,
        },
    ];

    for (const item of rooms) {
        await prisma.diagnosticRoom.upsert({
            where: { diagnosticRoomCode: item.diagnosticRoomCode },
            update: {
                diagnosticRoomName: item.diagnosticRoomName,
                modality: item.modality,
                location: item.location,
                isActive: item.isActive,
            },
            create: item,
        });
    }

    const count = await prisma.diagnosticRoom.count();
    console.log(`Seeded diagnostic rooms, total in DB: ${count}`);
}
