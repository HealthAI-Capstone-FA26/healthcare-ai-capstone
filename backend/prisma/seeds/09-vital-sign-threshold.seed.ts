import { PrismaService } from 'prisma/prisma.service';

export async function seedVitalSignThresholds(prisma: PrismaService) {
    const items = await prisma.vitalSignItem.findMany();
    const itemMap = new Map(items.map((i) => [i.itemCode, i.itemId]));

    const hrId = itemMap.get('HR');
    const sbpId = itemMap.get('SBP');
    const dbpId = itemMap.get('DBP');
    const rrId = itemMap.get('RR');
    const spo2Id = itemMap.get('SPO2');
    const tempId = itemMap.get('TEMP');

    const effectiveFrom = new Date('2026-01-01');

    // Nguồn: PedsCases Pediatric Vital Signs Reference Chart (dựa trên PALS Guidelines 2015),
    // hiệu đính 2020. KHÔNG bao gồm Neonate (<28 ngày) theo yêu cầu.
    const PEDS_REFERENCE_URL =
        'https://www.pedscases.com/sites/default/files/Vitals%20Chart_PedsCases%20Notes.pdf';
    const SOURCE_PEDIATRIC = `PALS Guidelines 2015 - PedsCases Vital Signs Reference Chart (${PEDS_REFERENCE_URL})`;

    // Mô hình threshold: CHỈ có minNormal/maxNormal (không còn minCritical/maxCritical/
    // minWarning/maxWarning). Value nằm ngoài [minNormal, maxNormal] = bất thường (critical),
    // không có vùng đệm/cảnh báo trung gian.
    //
    // ⚠️ LƯU Ý VỀ NHIỄU CẢNH BÁO: nhiều dải minNormal/maxNormal dưới đây được tính bằng
    // mean±1 standard deviation (NCFIT nhi, Su et al. 2022 người già) — về mặt thống kê,
    // mean±1SD chỉ bao phủ ~68% dân số khỏe mạnh. Nghĩa là ~32% người khỏe mạnh bình thường
    // sẽ có ít nhất 1 chỉ số rơi ngoài dải này và bị gắn nhãn 'critical' ngay, dù trước đây
    // (khi còn minCritical riêng) những giá trị này chỉ ở mức nhẹ/không đáng báo động. Cân
    // nhắc kỹ trước khi dùng ở production vì có thể gây báo động giả (alarm fatigue) nhiều
    // hơn hẳn so với mô hình 2 tầng trước đó.

    // SpO2: chart không cho dải "Normal" theo tuổi cho trẻ (ngoài giai đoạn sơ sinh), chỉ nêu
    // ngưỡng cảnh báo "<90-92%". minNormal dưới đây (95) là giả định chung dựa trên ngưỡng đó,
    // CHƯA có nguồn xác thực riêng theo tuổi từ chart này - cần xác nhận lâm sàng.
    const NOTE_SPO2_NORMAL_ASSUMED = 'dải SpO2 bình thường theo tuổi là giả định, cần xác nhận lâm sàng';

    // ===== Temperature (nhi, 1-15 tuổi) =====
    // NGUỒN MỚI (thay cho giả định Axillary 36.5-37.5°C trước đây): nghiên cứu so sánh
    // nhiệt độ đo bằng máy hồng ngoại không tiếp xúc trán (NCFIT - Non-Contact Forehead
    // Infrared Temperature) và nhiệt kế hồng ngoại màng nhĩ (IRTT) theo nhóm tuổi.
    // Nguồn: https://pmc.ncbi.nlm.nih.gov/articles/PMC9497495/ (Table 2).
    //
    // Theo quyết định sản phẩm: dùng mean ± std của cột NCFIT (a) cho từng nhóm tuổi để tạo dải
    // "Normal" (minNormal = mean-std, maxNormal = mean+std). Không có ngưỡng critical riêng -
    // ra khỏi dải mean±std là coi như bất thường (critical) ngay, không có vùng đệm.
    // Nhóm "age < 1 (n=26), mean=37.22±0.70)" trong bài KHÔNG được đưa vào seed này theo yêu cầu.
    //
    // Ghi chú phương pháp đo: NCFIT là đo hồng ngoại không tiếp xúc ở trán, KHÔNG phải Axillary
    // (nách). Giá trị mean NCFIT trong bài (37.17 - 37.36°C) tình cờ nằm gần dải Axillary giả
    // định trước đây (36.5-37.5°C), nhưng đây là hai phương pháp đo khác nhau. Hệ thống hiện
    // chưa có field lưu phương pháp đo -> vẫn cần xác nhận sản phẩm/lâm sàng trước khi dùng,
    // đặc biệt nếu app cho nhập nhiệt độ đo bằng phương pháp khác (rectal/oral/tympanic/axillary)
    // mà so sánh với ngưỡng NCFIT này sẽ không tương thích.
    const NCFIT_REFERENCE_URL = 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9497495/';
    const SOURCE_TEMP_NCFIT = (mean: number, sd: number, n: number) =>
        `NCFIT (Non-Contact Forehead Infrared Temperature) mean=${mean}°C, std=${sd}, n=${n} (${NCFIT_REFERENCE_URL}, Table 2) - ` +
        `dải normal = mean±std, KHÔNG phải Axillary`;

    // NEWS2 áp dụng chính thức cho người lớn >=16 tuổi (Royal College of Physicians, 2017)
    const NEWS2_REFERENCE_URL =
        'https://www.rcp.ac.uk/media/alxev00t/news2-chart-1_the-news-scoring-system_0_0.pdf';
    const SOURCE_ADULT = `NEWS2 - Royal College of Physicians London 2017 (${NEWS2_REFERENCE_URL})`;

    // NEWS2 KHÔNG chấm điểm huyết áp tâm trương (DBP) — chart 1 chỉ có SBP, nên không có
    // "Normal" chính thức từ NEWS2 cho DBP người lớn. Dải minNormal/maxNormal dưới đây là
    // ước lượng lâm sàng chung, không phải trích từ NEWS2.
    const SOURCE_DBP_ADULT = `Ước lượng lâm sàng chung cho DBP người lớn (không phải từ NEWS2)`;

    // ===== HR / SBP / DBP / RR / SpO2 (người cao tuổi, >= 65 tuổi) =====
    // Nguồn: Su YC, Chien CY, et al. "Revising Vital Signs Criteria for Accurate Triage of Older
    // Adults in the Emergency Department", Int J Gen Med. 2022;15:6227-6235,
    // doi:10.2147/IJGM.S373396, https://www.dovepress.com/article/download/76685
    // Dữ liệu gộp 3 cơ sở dữ liệu ED Đài Loan (LCGMH+CGRD+TPECH), n=174,239 bệnh nhân ED ≥65 tuổi.
    //
    // minNormal/maxNormal: dùng mean±std từ Table 1 (Baseline Characteristics, cột Total) - nhất
    // quán với cách làm cho nhóm nhi (NCFIT).
    //
    // (Lưu ý lịch sử: bài báo còn tự đề xuất ngưỡng "TTAS level 1" - nguy kịch dựa trên tỷ lệ
    // biến cố nặng thực tế cho HR <40/>140, SBP <80, RR <10, SpO2 <90 - nhưng hệ thống hiện
    // KHÔNG còn lưu ngưỡng critical riêng nữa, nên các con số này không còn được dùng.)
    const SU2022_REFERENCE_URL = 'https://www.dovepress.com/article/download/76685';
    const SOURCE_SU2022 = (label: string, mean: number, sd: number) =>
        `Su et al. 2022, Revising Vital Signs Criteria for Older Adults in ED, Int J Gen Med ` +
        `(doi:10.2147/IJGM.S373396) (${SU2022_REFERENCE_URL}), Table 1 Total n=174,239: ${label} mean=${mean}, std=${sd} ` +
        `-> normal=mean±std`;

    // ===== Temperature (người cao tuổi, >= 65 tuổi) =====
    // Nguồn: Fox et al., "Temperature regulation in the elderly" (PubMed 16398904),
    // https://pubmed.ncbi.nlm.nih.gov/16398904/. Nghiên cứu đo nhiệt độ (oral) trên người cao
    // tuổi (tuổi TB 80.7) tại nursing home (6h/16h/22h) và community dwellers (giữa trưa).
    // Kết quả: nhiệt độ dao động 94.0-99.6°F trên toàn bộ số liệu đo được; mean theo mốc giờ dao
    // động 97.3-97.8°F (nursing home) và 97.7°F (community); 86-97% số lần đo THẤP HƠN 98.6°F
    // (mốc "bình thường" kinh điển cho người trẻ) tùy mốc giờ - cho thấy baseline nhiệt độ người
    // cao tuổi thấp hơn đáng kể so với người trẻ.
    //
    // Nguồn KHÔNG cung cấp std, chỉ có khoảng quan sát (range) và các mean rời rạc theo giờ đo.
    // Quyết định sản phẩm: dùng NGUYÊN khoảng quan sát 94.0-99.6°F (quy đổi 34.4-37.6°C) làm dải
    // minNormal-maxNormal, vì đây là số liệu trực tiếp từ nghiên cứu (không suy diễn thêm); dùng
    // khoảng các mean theo giờ (97.3-97.8°F) sẽ quá hẹp so với biến thiên cá nhân thực tế và dễ
    // gây báo động giả. Không có ngưỡng critical riêng từ nguồn này.
    const ELDERLY_TEMP_REFERENCE_URL = 'https://pubmed.ncbi.nlm.nih.gov/16398904/';
    const SOURCE_TEMP_ELDERLY = `Fox et al. 2006, temperature regulation in the elderly (range 94.0-99.6°F đo tại nursing ` +
        `home + community dwellers, n≈196, tuổi TB 80.7) (${ELDERLY_TEMP_REFERENCE_URL}) - dải normal = ` +
        `khoảng quan sát trực tiếp (không có std trong nguồn)`;

    const thresholds = [
        // ===== NHI - nguồn PedsCases/PALS 2015 =====
        // Chỉ dùng giá trị "Awake" của chart (giả định rằng trẻ sẽ được đo khi thức).
        // Trẻ dưới 1 tuổi hiện KHÔNG có ngưỡng trong hệ thống - cần bổ sung riêng khi có yêu cầu.

        // Toddler (1-2 tuổi) - nhóm tuổi nhỏ nhất được xét (bỏ qua Infant <1 tuổi theo yêu cầu,
        // nên hệ thống hiện chưa có ngưỡng cho trẻ dưới 1 tuổi)
        { itemId: hrId, ageMin: 1, ageMax: 2, minNormal: 98, maxNormal: 140, sourceReference: `${SOURCE_PEDIATRIC} - HR (Awake)` },
        { itemId: sbpId, ageMin: 1, ageMax: 2, minNormal: 86, maxNormal: 106, sourceReference: `${SOURCE_PEDIATRIC} - Systolic Hypotension <70+(tuổi×2)` },
        { itemId: dbpId, ageMin: 1, ageMax: 2, minNormal: 42, maxNormal: 63, sourceReference: `${SOURCE_PEDIATRIC}` },
        { itemId: rrId, ageMin: 1, ageMax: 2, minNormal: 22, maxNormal: 37, sourceReference: `${SOURCE_PEDIATRIC}` },
        { itemId: spo2Id, ageMin: 1, ageMax: 2, minNormal: 95, maxNormal: 100, sourceReference: `${SOURCE_PEDIATRIC}; ${NOTE_SPO2_NORMAL_ASSUMED}` },

        // Preschool (3-5 tuổi)
        { itemId: hrId, ageMin: 3, ageMax: 5, minNormal: 80, maxNormal: 120, sourceReference: `${SOURCE_PEDIATRIC} - HR (Awake)` },
        { itemId: sbpId, ageMin: 3, ageMax: 5, minNormal: 89, maxNormal: 112, sourceReference: `${SOURCE_PEDIATRIC} - Systolic Hypotension <70+(tuổi×2)` },
        { itemId: dbpId, ageMin: 3, ageMax: 5, minNormal: 46, maxNormal: 72, sourceReference: `${SOURCE_PEDIATRIC}` },
        { itemId: rrId, ageMin: 3, ageMax: 5, minNormal: 20, maxNormal: 28, sourceReference: `${SOURCE_PEDIATRIC}` },
        { itemId: spo2Id, ageMin: 3, ageMax: 5, minNormal: 95, maxNormal: 100, sourceReference: `${SOURCE_PEDIATRIC}; ${NOTE_SPO2_NORMAL_ASSUMED}` },

        // School-age (6-9 tuổi) - HR/RR dùng chung dải "School-age (6-11y)" của chart
        { itemId: hrId, ageMin: 6, ageMax: 9, minNormal: 75, maxNormal: 118, sourceReference: `${SOURCE_PEDIATRIC} - HR (Awake, dải 6-11y)` },
        { itemId: sbpId, ageMin: 6, ageMax: 9, minNormal: 97, maxNormal: 115, sourceReference: `${SOURCE_PEDIATRIC} - Systolic Hypotension <70+(tuổi×2)` },
        { itemId: dbpId, ageMin: 6, ageMax: 9, minNormal: 57, maxNormal: 76, sourceReference: `${SOURCE_PEDIATRIC}` },
        { itemId: rrId, ageMin: 6, ageMax: 9, minNormal: 18, maxNormal: 25, sourceReference: `${SOURCE_PEDIATRIC} (6-11y)` },
        { itemId: spo2Id, ageMin: 6, ageMax: 9, minNormal: 95, maxNormal: 100, sourceReference: `${SOURCE_PEDIATRIC}; ${NOTE_SPO2_NORMAL_ASSUMED}` },

        // Preadolescent (10-11 tuổi) - HR/RR vẫn dùng dải "School-age (6-11y)", BP có dải riêng
        { itemId: hrId, ageMin: 10, ageMax: 11, minNormal: 75, maxNormal: 118, sourceReference: `${SOURCE_PEDIATRIC} - HR (Awake, dải 6-11y)` },
        { itemId: sbpId, ageMin: 10, ageMax: 11, minNormal: 102, maxNormal: 120, sourceReference: `${SOURCE_PEDIATRIC} - Systolic Hypotension <70+(tuổi×2)` },
        { itemId: dbpId, ageMin: 10, ageMax: 11, minNormal: 61, maxNormal: 80, sourceReference: `${SOURCE_PEDIATRIC}` },
        { itemId: rrId, ageMin: 10, ageMax: 11, minNormal: 18, maxNormal: 25, sourceReference: `${SOURCE_PEDIATRIC} (6-11y)` },
        { itemId: spo2Id, ageMin: 10, ageMax: 11, minNormal: 95, maxNormal: 100, sourceReference: `${SOURCE_PEDIATRIC}; ${NOTE_SPO2_NORMAL_ASSUMED}` },

        // Adolescent (12-15 tuổi) - lấp khoảng hở trước NEWS2 (16+)
        { itemId: hrId, ageMin: 12, ageMax: 15, minNormal: 60, maxNormal: 100, sourceReference: `${SOURCE_PEDIATRIC} - HR (Awake)` },
        { itemId: sbpId, ageMin: 12, ageMax: 15, minNormal: 110, maxNormal: 131, sourceReference: `${SOURCE_PEDIATRIC} - Systolic Hypotension <90` },
        { itemId: dbpId, ageMin: 12, ageMax: 15, minNormal: 64, maxNormal: 83, sourceReference: `${SOURCE_PEDIATRIC}` },
        { itemId: rrId, ageMin: 12, ageMax: 15, minNormal: 12, maxNormal: 20, sourceReference: `${SOURCE_PEDIATRIC}` },
        { itemId: spo2Id, ageMin: 12, ageMax: 15, minNormal: 95, maxNormal: 100, sourceReference: `${SOURCE_PEDIATRIC}; ${NOTE_SPO2_NORMAL_ASSUMED}` },

        // Temperature (nhi, theo NCFIT mean±std - Table 2, PMC9497495): 3 nhóm tuổi theo đúng bảng
        // gốc. Nhóm "12 ≤ age < 18" trong bài bị GIỚI HẠN lại thành 12-15 để không chồng lấn với
        // dải NEWS2 người lớn (16-64) đã có sẵn bên dưới. Nhóm "age < 1" KHÔNG được đưa vào.
        { itemId: tempId, ageMin: 1, ageMax: 5, minNormal: 36.65, maxNormal: 38.07, sourceReference: SOURCE_TEMP_NCFIT(37.36, 0.71, 50) },   // 1 ≤ age < 6, 37.36±0.71
        { itemId: tempId, ageMin: 6, ageMax: 11, minNormal: 36.62, maxNormal: 37.72, sourceReference: SOURCE_TEMP_NCFIT(37.17, 0.55, 82) },  // 6 ≤ age < 12, 37.17±0.55
        { itemId: tempId, ageMin: 12, ageMax: 15, minNormal: 36.62, maxNormal: 37.86, sourceReference: SOURCE_TEMP_NCFIT(37.24, 0.62, 97) }, // 12 ≤ age < 18 (giới hạn tới 15, xem ghi chú trên), 37.24±0.62

        // NGƯỜI LỚN (16 - 64 tuổi) - theo đúng Chart 1 (NEWS2), dải "Normal" = cột điểm 0,
        // dải "Critical" = ngưỡng chấm điểm 3 ("Red score" - kích hoạt phản ứng khẩn theo Chart 2)
        { itemId: hrId, ageMin: 16, ageMax: 64, minNormal: 51, maxNormal: 90, sourceReference: SOURCE_ADULT },
        { itemId: sbpId, ageMin: 16, ageMax: 64, minNormal: 111, maxNormal: 219, sourceReference: SOURCE_ADULT },
        { itemId: dbpId, ageMin: 16, ageMax: 64, minNormal: 60, maxNormal: 79, sourceReference: SOURCE_DBP_ADULT },
        { itemId: rrId, ageMin: 16, ageMax: 64, minNormal: 12, maxNormal: 20, sourceReference: SOURCE_ADULT },
        { itemId: spo2Id, ageMin: 16, ageMax: 64, minNormal: 96, maxNormal: 100, sourceReference: SOURCE_ADULT },
        { itemId: tempId, ageMin: 16, ageMax: 64, minNormal: 36.1, maxNormal: 38.0, sourceReference: SOURCE_ADULT },

        // NGƯỜI CAO TUỔI (>= 65 tuổi) - HR/SBP/DBP/RR/SpO2 theo Su et al. 2022 (xem comment ở
        // trên); TEMP theo Fox et al. 2006 (xem SOURCE_TEMP_ELDERLY ở trên).
        { itemId: hrId, ageMin: 65, ageMax: 150, minNormal: 68.51, maxNormal: 108.19, sourceReference: SOURCE_SU2022('HR', 88.35, 19.84) },
        { itemId: sbpId, ageMin: 65, ageMax: 150, minNormal: 116.15, maxNormal: 180.67, sourceReference: SOURCE_SU2022('SBP', 148.41, 32.26) },
        { itemId: dbpId, ageMin: 65, ageMax: 150, minNormal: 62.55, maxNormal: 95.61, sourceReference: `${SOURCE_SU2022('DBP', 79.08, 16.53)} (DBP không phải modifier trong TTAS - không có ngưỡng critical riêng)` },
        { itemId: rrId, ageMin: 65, ageMax: 150, minNormal: 16.23, maxNormal: 21.99, sourceReference: SOURCE_SU2022('RR', 19.11, 2.88) },
        { itemId: spo2Id, ageMin: 65, ageMax: 150, minNormal: 91.30, maxNormal: 99.90, sourceReference: SOURCE_SU2022('SpO2', 95.60, 4.30) },
        { itemId: tempId, ageMin: 65, ageMax: 150, minNormal: 34.4, maxNormal: 37.6, sourceReference: SOURCE_TEMP_ELDERLY }, // 94.0-99.6°F, Fox et al. 2006
    ];

    await prisma.vitalSignThreshold.deleteMany();

    for (const t of thresholds) {
        if (!t.itemId) continue;
        await prisma.vitalSignThreshold.create({
            data: {
                itemId: t.itemId,
                ageMin: t.ageMin,
                ageMax: t.ageMax,
                gender: null,
                minNormal: t.minNormal,
                maxNormal: t.maxNormal,
                effectiveFrom,
                isActive: true,
                sourceReference: t.sourceReference,
            },
        });
    }

    const count = await prisma.vitalSignThreshold.count();
    console.log(`Seeded vital sign thresholds, total in DB: ${count}`);
}