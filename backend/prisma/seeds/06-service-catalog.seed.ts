import { PrismaService } from 'prisma/prisma.service';

/**
 * Danh mục dịch vụ cận lâm sàng (ServiceCatalog) cho cả 4 modality của phòng khám Tim mạch:
 *   - blood_test : xét nghiệm máu — resultKind = 'parametric' (kết quả là các chỉ số đo đạc -> ResultValue)
 *   - ecg        : điện tâm đồ 12 chuyển đạo — resultKind = 'waveform' (bản ghi sóng ECG -> EcgRecording, AI phân tích bất thường)
 *   - echo       : siêu âm tim qua thành ngực — resultKind = 'image_report' (kết luận/mô tả + ảnh/clip đính kèm)
 *   - xray       : X-quang ngực thẳng — resultKind = 'image_report' (kết luận/mô tả + ảnh DICOM/JPG đính kèm)
 *
 * Bám theo Registration (SE02/SE04): "blood tests for cardiac biomarkers and lipid profiles", ECG, siêu âm tim, X-quang ngực;
 * cộng thêm các xét nghiệm nền thường đi kèm khi khám tim mạch (công thức máu, sinh hóa cơ bản, điện giải).
 *
 * Echo / X-quang là 'image_report' nên KHÔNG có ResultParameter (07-) — bác sĩ/KTV nhập findings + overallConclusion.
 *
 * ⚠️ `price` là GIÁ MẪU (VND) — phải thay bằng bảng giá thật của phòng khám trước khi dùng cho thanh toán (SE03).
 * ⚠️ `turnaroundMins`, `preparationNote` là giá trị tham khảo, cần phòng chức năng xác nhận.
 *
 * Phụ thuộc DiagnosticRoom (05-diagnostic-room.seed.ts) — seed này chạy SAU.
 * ResultParameter (07-) và ResultParameterThreshold (20-) tham chiếu ngược lại danh mục này theo serviceCode (chỉ blood_test).
 */
export async function seedServiceCatalog(prisma: PrismaService): Promise<void> {
    const roomCodes = ['BLOOD-LAB', 'ECG-ROOM', 'ECHO-ROOM', 'XRAY-ROOM'];
    const roomRows = await prisma.diagnosticRoom.findMany({ where: { diagnosticRoomCode: { in: roomCodes } } });
    const roomByCode = new Map(roomRows.map((r) => [r.diagnosticRoomCode, r]));
    for (const code of roomCodes) {
        if (!roomByCode.has(code)) {
            throw new Error(
                `Không tìm thấy DiagnosticRoom '${code}' — hãy chắc chắn 05-diagnostic-room.seed.ts đã chạy trước.`,
            );
        }
    }
    const room = roomByCode.get('BLOOD-LAB')!;

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

    // ── ECG / Siêu âm tim / X-quang ngực ───────────────────────────────────────────────────────────────
    const nonBloodServices = [
        {
            serviceCode: 'RESTECG12',
            serviceName: 'Điện tâm đồ 12 chuyển đạo lúc nghỉ (Resting 12-lead ECG)',
            modality: 'ecg',
            panelGroup: 'resting_ecg',
            resultKind: 'waveform',
            roomCode: 'ECG-ROOM',
            preparationNote: 'Nghỉ ngơi 5 phút trước khi đo, nằm ngửa, bộc lộ vùng ngực và cổ tay/cổ chân',
            price: 150000,
            turnaroundMins: 15,
        },
        {
            serviceCode: 'TTE',
            serviceName: 'Siêu âm tim qua thành ngực (Transthoracic Echocardiography)',
            modality: 'echo',
            panelGroup: 'tte',
            resultKind: 'image_report',
            roomCode: 'ECHO-ROOM',
            preparationNote: 'Không cần nhịn ăn; mặc áo dễ cởi',
            price: 400000,
            turnaroundMins: 30,
        },
        {
            serviceCode: 'CXRPA',
            serviceName: 'X-quang ngực thẳng (Chest X-ray PA)',
            modality: 'xray',
            panelGroup: 'chest_xray',
            resultKind: 'image_report',
            roomCode: 'XRAY-ROOM',
            preparationNote: 'Tháo trang sức/vật kim loại vùng cổ - ngực; phụ nữ có thai hoặc nghi có thai báo nhân viên trước khi chụp',
            price: 200000,
            turnaroundMins: 15,
        },
    ];

    for (const s of nonBloodServices) {
        const data = {
            serviceName: s.serviceName,
            modality: s.modality,
            panelGroup: s.panelGroup,
            resultKind: s.resultKind,
            specimenType: null,
            requiresFasting: false,
            preparationNote: s.preparationNote,
            price: s.price,
            turnaroundMins: s.turnaroundMins,
            defaultRoomId: roomByCode.get(s.roomCode)!.diagnosticRoomId,
            isActive: true,
        };
        await prisma.serviceCatalog.upsert({
            where: { serviceCode: s.serviceCode },
            update: data,
            create: { serviceCode: s.serviceCode, ...data },
        });
    }

    const count = await prisma.serviceCatalog.count();
    console.log(`Seeded service catalog (blood_test + ecg + echo + xray), total in DB: ${count}`);
}
