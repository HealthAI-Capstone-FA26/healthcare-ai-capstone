import { PrismaService } from 'prisma/prisma.service';

/**
 * Danh mục phòng cận lâm sàng (DiagnosticRoom) — đủ 4 phòng theo Registration (SE04):
 *   1. BLOOD-LAB  — Phòng Xét nghiệm máu        (modality = 'blood_test')
 *   2. ECG-ROOM   — Phòng Điện tâm đồ (ECG)      (modality = 'ecg')   <- có phân tích bất thường bằng AI
 *   3. ECHO-ROOM  — Phòng Siêu âm tim            (modality = 'echo')
 *   4. XRAY-ROOM  — Phòng X-quang ngực           (modality = 'xray')
 *
 * Bảng này không có endpoint tạo mới (LabRoomService chỉ có list + phân công KTV), nên phải seed sẵn.
 * ServiceCatalog.defaultRoomId tham chiếu tới bảng này -> seed này chạy TRƯỚC 06-service-catalog.
 *
 * `location` là giá trị MẪU, cần thay bằng vị trí thật của phòng khám.
 * Sau khi seed, quản trị viên phân công KTV cho từng phòng qua API phân công (DiagnosticStaffRoomAssignment).
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
        {
            diagnosticRoomCode: 'ECG-ROOM',
            diagnosticRoomName: 'Phòng Điện tâm đồ (ECG Room)',
            modality: 'ecg',
            location: 'Tầng 2 - Khu Thăm dò chức năng tim - Phòng 201',
            isActive: true,
        },
        {
            diagnosticRoomCode: 'ECHO-ROOM',
            diagnosticRoomName: 'Phòng Siêu âm tim (Echocardiography Room)',
            modality: 'echo',
            location: 'Tầng 2 - Khu Thăm dò chức năng tim - Phòng 202',
            isActive: true,
        },
        {
            diagnosticRoomCode: 'XRAY-ROOM',
            diagnosticRoomName: 'Phòng X-quang ngực (Chest X-ray Room)',
            modality: 'xray',
            location: 'Tầng 1 - Khu Chẩn đoán hình ảnh - Phòng 108',
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
