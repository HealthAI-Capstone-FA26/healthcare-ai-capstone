import { PrismaService } from 'prisma/prisma.service';

/**
 * Danh mục dịch vụ cận lâm sàng (ServiceCatalog) cho cả 4 modality của phòng khám Tim mạch — mỗi phòng 1 dịch vụ:
 *   - blood_test : xét nghiệm máu — CHỈ 1 dịch vụ 'BLOODFULL' (Full panel: CBC + sinh hóa + điện giải + mỡ máu + dấu ấn tim)
 *                  resultKind = 'parametric' (kết quả là các chỉ số đo đạc -> ResultValue). 1 lần chỉ định = 1 order item
 *                  = 1 task = 1 lần lấy mẫu (trước đây tách 7 gói riêng).
 *   - ecg        : điện tâm đồ 12 chuyển đạo — resultKind = 'waveform' (bản ghi sóng ECG -> EcgRecording, AI phân tích bất thường)
 *   - echo       : siêu âm tim qua thành ngực — resultKind = 'image_report' (kết luận/mô tả + ảnh/clip đính kèm)
 *   - xray       : X-quang ngực thẳng — resultKind = 'image_report' (kết luận/mô tả + ảnh DICOM/JPG đính kèm)
 *
 * Bám theo Registration (SE02/SE04): "blood tests for cardiac biomarkers and lipid profiles", ECG, siêu âm tim, X-quang ngực;
 * cộng thêm các xét nghiệm nền thường đi kèm khi khám tim mạch (công thức máu, sinh hóa cơ bản, điện giải) — tất cả gộp trong BLOODFULL.
 *
 * 7 gói cũ (CBC, BIOC01, ELEC01, LIPID01, HSTNT, CKMB, NTPROBNP) bị gỡ khỏi danh mục: nếu chưa có chỉ định/sự kiện nào tham chiếu
 * thì xóa hẳn (cùng tham số + ngưỡng của chúng); ngược lại chỉ đặt isActive = false để giữ lịch sử.
 *
 * Echo / X-quang là 'image_report' nên KHÔNG có ResultParameter (07-) — bác sĩ/KTV nhập findings + overallConclusion.
 *
 * `price` là GIÁ MẪU (VND) — phải thay bằng bảng giá thật của phòng khám trước khi dùng cho thanh toán (SE03).
 * `turnaroundMins`, `preparationNote` là giá trị tham khảo, cần phòng chức năng xác nhận.
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

    // ── Xét nghiệm máu: 1 dịch vụ duy nhất (Full panel) ───────────────────────────────────────────────
    // price = 500.000đ là GIÁ MẪU (= tổng 7 gói cũ), cần thay bằng bảng giá thật.
    // turnaroundMins = 240 theo chỉ số chậm nhất (lipid) — hs-TnT trong combo ra chậm; ca đau ngực cấp cần chỉ định STAT riêng.
    // requiresFasting = true vì gói có glucose đói (Labcorp: CMP nên nhịn 12 giờ, renal panel ưu tiên 12 giờ, tối thiểu 8 giờ):
    //   https://www.labcorp.com/tests/322000/comprehensive-metabolic-panel-cmp
    //   https://www.labcorp.com/tests/322777/renal-function-panel
    // Riêng mỡ máu thì nhịn ăn KHÔNG bắt buộc thường quy (chỉ nên lặp lại lúc đói khi TG không nhịn > 440 mg/dL theo EAS/EFLM,
    // hoặc TG >= 400 mg/dL theo hướng dẫn AHA/ACC 2018):
    //   https://pmc.ncbi.nlm.nih.gov/articles/PMC4929379   (đồng thuận EAS/EFLM 2016)
    //   https://pmc.ncbi.nlm.nih.gov/articles/PMC8243861   (tổng quan các hướng dẫn quốc tế)
    // Phòng Lab quyết định có chấp nhận mẫu không nhịn ăn cho BLOODFULL hay không.
    const bloodFull = {
        serviceCode: 'BLOODFULL',
        serviceName: 'Xét nghiệm máu tổng quát tim mạch (Full panel: CBC, sinh hóa, điện giải, mỡ máu, dấu ấn tim)',
        modality: 'blood_test',
        panelGroup: 'full_blood_panel',
        resultKind: 'parametric',
        specimenType: 'whole_blood', // combo gồm cả mẫu huyết thanh/máu toàn phần — KTV tự tách ống theo chỉ số
        requiresFasting: true,
        preparationNote: 'Nhịn ăn 9–12 giờ trước khi lấy máu (chỉ uống nước lọc) để đo glucose lúc đói; tránh rượu bia 24 giờ trước.',
        price: 500000,
        turnaroundMins: 240,
    };
    {
        const { serviceCode, ...data } = bloodFull;
        const payload = { ...data, defaultRoomId: room.diagnosticRoomId, isActive: true };
        await prisma.serviceCatalog.upsert({
            where: { serviceCode },
            update: payload,
            create: { serviceCode, ...payload },
        });
    }

    // ── Gỡ 7 gói máu cũ ────────────────────────────────────────────────────────────────────────────────
    const legacyBloodCodes = ['CBC', 'BIOC01', 'ELEC01', 'LIPID01', 'HSTNT', 'CKMB', 'NTPROBNP'];
    const legacy = await prisma.serviceCatalog.findMany({ where: { serviceCode: { in: legacyBloodCodes } } });
    for (const old of legacy) {
        const [orderItems, stageEvents, stageStatistics] = await Promise.all([
            prisma.diagnosticOrderItem.count({ where: { serviceId: old.serviceId } }),
            prisma.encounterStageEvent.count({ where: { serviceId: old.serviceId } }),
            prisma.stageStatistic.count({ where: { serviceId: old.serviceId } }),
        ]);
        if (orderItems + stageEvents + stageStatistics === 0) {
            // Chưa ai dùng -> xóa hẳn theo thứ tự FK: ngưỡng -> tham số -> dịch vụ.
            await prisma.$transaction([
                prisma.resultParameterThreshold.deleteMany({ where: { parameter: { serviceId: old.serviceId } } }),
                prisma.resultParameter.deleteMany({ where: { serviceId: old.serviceId } }),
                prisma.serviceCatalog.delete({ where: { serviceId: old.serviceId } }),
            ]);
        } else {
            // Đã có lịch sử -> giữ lại nhưng không cho chỉ định mới.
            await prisma.serviceCatalog.update({ where: { serviceId: old.serviceId }, data: { isActive: false } });
        }
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
    console.log(`Seeded service catalog (BLOODFULL + ecg + echo + xray), total in DB: ${count}`);
}
