import { PrismaService } from 'prisma/prisma.service';

// ════════════════════════════════════════════════════════════════════════════════════════════
// SEED DANH MỤC KHOA — Bệnh viện Đa khoa Tâm Anh
//
// Nguồn danh mục: https://tamanhhospital.vn/chuyen-khoa/ (47 mục, gồm cả khoa hành chính/cận lâm sàng).
// Ở đây CHỈ đưa các khoa/trung tâm mà bệnh nhân có thể tự đặt lịch khám theo triệu chứng. KHÔNG đưa:
// Dược, Xét nghiệm, Chẩn đoán hình ảnh, Giải phẫu bệnh, Kiểm soát nhiễm khuẩn, Gây mê hồi sức, ICU,
// Đào tạo–NCKH, Xạ trị, Tế bào gốc, các trung tâm phẫu thuật chuyên sâu (Tim–Mạch máu–Lồng ngực, Tim mạch
// can thiệp, Ngoại nhi, Nội soi tiêu hoá) — đây là đơn vị tuyến sau/chỉ định, không phải điểm vào theo triệu chứng.
//
// QUY TẮC VIẾT symptomKeywords (bộ so khớp ở department-suggestion/keyword-matcher.util.ts):
//  1. Khớp theo TOKEN (âm tiết) nguyên vẹn, ưu tiên có dấu. Không cần thêm biến thể không dấu — matcher tự xử lý
//     khi người dùng gõ không dấu (chỉ với cụm >= 2 âm tiết).
//  2. Tránh từ khoá 1 âm tiết trừ khi bất khả kháng (ho, sốt, trĩ, sởi, ngất, xỉu, bỏng...). Chúng có độ đặc hiệu thấp.
//  3. Dùng cả thuật ngữ y khoa lẫn cách nói dân dã, kể cả phương ngữ Nam Bộ (ói/mắc ói, đi cầu, nhức đầu...).
//  4. Cụm dài hơn thắng cụm ngắn hơn nằm trong nó ("đau bụng kinh" > "đau bụng"), nên được phép lồng nhau
//     GIỮA các khoa; nhưng KHÔNG được trùng y hệt giữa 2 khoa — validateDepartmentSeed() sẽ chặn.
//  5. Cụm phải khớp LIỀN MẠCH. Muốn bắt "con tôi bị sốt" thì dựa vào ngữ cảnh nhi khoa (tuổi/"con tôi"/"bé")
//     chứ không nhét mọi tổ hợp đại từ vào keyword.
//  6. Dấu hiệu CẤP CỨU (đột quỵ, nhồi máu, khó thở nặng, tự tử...) KHÔNG cậy vào seed: chúng nằm trong code ở
//     emergency-red-flags.ts để admin sửa DB không làm mất lớp an toàn. Keyword của khoa Cấp cứu ở đây chỉ bổ
//     sung các tình huống "nên đến cấp cứu" ít nguy hiểm hơn.
//
// ⚠️ Cần xác nhận với bệnh viện trước khi go-live (xem REVIEW.md, mục 5):
//  - roomLocation bên dưới là GIÁ TRỊ MẪU giữ nguyên quy ước cũ. Tâm Anh có nhiều cơ sở (Hà Nội, TP.HCM, Q.8 và các
//    phòng khám Cầu Giấy, Q.7), mỗi cơ sở bố trí khác nhau — cần thay bằng dữ liệu thật (hoặc tách theo cơ sở).
//  - Cách gán một số nhóm triệu chứng vào khoa (chấn thương chỉnh hình, vú, tâm thần/giấc ngủ, chậm phát triển ở trẻ)
//    là suy luận theo tên khoa công bố, cần bác sĩ trưởng khoa duyệt.
// ════════════════════════════════════════════════════════════════════════════════════════════

export interface DepartmentSeedItem {
    departmentCode: string;
    departmentName: string;
    description: string;
    roomLocation: string;
    isActive: boolean;
    symptomKeywords: string[];
}

export const DEPARTMENT_SEED: DepartmentSeedItem[] = [
    // ───────────── Điểm tiếp nhận / khám tổng quát ─────────────
    {
        departmentCode: 'GEN',
        departmentName: 'Khoa Khám bệnh',
        description: 'Tiếp nhận, khám sức khỏe tổng quát và chuyên khoa; hướng dẫn người bệnh chọn đúng chuyên khoa',
        roomLocation: 'Tầng 1 - Khu tiếp nhận',
        isActive: true,
        symptomKeywords: [
            'khám sức khỏe', 'khám sức khỏe tổng quát', 'khám tổng quát', 'khám sức khỏe định kỳ', 'kiểm tra sức khỏe',
            'gói khám sức khỏe', 'tầm soát sức khỏe', 'khám sức khỏe xin việc', 'khám sức khỏe đi học',
            'khám sức khỏe lái xe', 'không biết khám khoa nào', 'chưa rõ khám khoa nào', 'khám bệnh chung',
        ],
    },
    {
        departmentCode: 'IM',
        departmentName: 'Khoa Nội tổng hợp',
        description: 'Khám và điều trị các bệnh nội khoa thường gặp ở người lớn, đánh giá ban đầu các triệu chứng toàn thân',
        roomLocation: 'Tầng 1 - Phòng 101',
        isActive: true,
        symptomKeywords: [
            'sốt', 'sốt cao', 'sốt kéo dài', 'sốt về chiều', 'sốt ớn lạnh', 'ớn lạnh', 'sốt siêu vi', 'nhiễm siêu vi',
            'sốt xuất huyết', 'cảm cúm', 'cảm lạnh', 'bị cúm', 'nhiễm covid', 'đau nhức người', 'nhức mỏi toàn thân',
            'mệt mỏi', 'mệt mỏi kéo dài', 'uể oải', 'chán ăn', 'ăn không ngon', 'sụt cân không rõ nguyên nhân',
            'sút cân nhanh', 'thiếu máu', 'da xanh xao', 'xanh xao', 'xét nghiệm máu bất thường', 'khám nội', 'khám nội tổng quát',
        ],
    },

    // ───────────── Nội khoa chuyên sâu ─────────────
    {
        departmentCode: 'GI',
        departmentName: 'Khoa Tiêu hóa - Gan mật - Tụy',
        description: 'Chẩn đoán, điều trị bệnh lý dạ dày, đại tràng, gan, mật, tụy; nội soi tiêu hóa; viêm gan và gan nhiễm mỡ',
        roomLocation: 'Tầng 2 - Phòng 201',
        isActive: true,
        symptomKeywords: [
            'đau bụng', 'đau bụng trên', 'đau bụng dưới', 'đau vùng bụng', 'đau thượng vị', 'đau dạ dày', 'đau bao tử',
            'đầy bụng', 'đầy hơi', 'chướng bụng', 'sình bụng', 'khó tiêu', 'ợ chua', 'ợ nóng', 'ợ hơi', 'trào ngược',
            'trào ngược dạ dày', 'nóng rát thượng vị', 'buồn nôn', 'mắc ói', 'nôn ói', 'nôn mửa', 'ói mửa',
            'tiêu chảy', 'đi ngoài phân lỏng', 'đi cầu phân lỏng', 'táo bón', 'đi cầu ra máu', 'đi ngoài ra máu',
            'phân có máu', 'viêm đại tràng', 'hội chứng ruột kích thích', 'viêm loét dạ dày', 'vi khuẩn hp',
            'khó nuốt', 'nuốt nghẹn', 'vàng da', 'vàng mắt', 'men gan cao', 'viêm gan', 'gan nhiễm mỡ', 'xơ gan',
            'đau hạ sườn phải', 'sỏi mật', 'viêm túi mật', 'viêm tụy', 'nội soi dạ dày', 'nội soi đại tràng',
            'khám tiêu hóa', 'khám gan mật',
        ],
    },
    {
        departmentCode: 'RESP',
        departmentName: 'Khoa Hô hấp',
        description: 'Khám và điều trị bệnh lý phổi, phế quản và đường hô hấp dưới',
        roomLocation: 'Tầng 2 - Phòng 202',
        isActive: true,
        symptomKeywords: [
            'ho', 'ho khan', 'ho có đờm', 'ho đờm', 'ho kéo dài', 'ho dai dẳng', 'ho về đêm', 'khạc đờm', 'khó thở',
            'thở khò khè', 'khò khè', 'thở rít', 'thở nhanh', 'đau ngực khi ho', 'hen suyễn', 'hen phế quản',
            'viêm phế quản', 'viêm phổi', 'phổi tắc nghẽn mạn tính', 'tràn dịch màng phổi', 'ngưng thở khi ngủ',
            'khám hô hấp', 'khám phổi', 'chụp phổi bất thường',
        ],
    },
    {
        departmentCode: 'END',
        departmentName: 'Khoa Nội tiết - Đái tháo đường',
        description: 'Điều trị đái tháo đường, bệnh tuyến giáp và các rối loạn nội tiết - chuyển hóa',
        roomLocation: 'Tầng 2 - Phòng 203',
        isActive: true,
        symptomKeywords: [
            'tiểu đường', 'đái tháo đường', 'tiền đái tháo đường', 'đường huyết cao', 'tăng đường huyết',
            'hạ đường huyết', 'kiểm tra đường huyết', 'khát nước nhiều', 'uống nhiều tiểu nhiều', 'tuyến giáp',
            'bướu cổ', 'nhân giáp', 'cường giáp', 'suy giáp', 'basedow', 'rối loạn nội tiết', 'rối loạn chuyển hóa',
            'khám nội tiết',
        ],
    },
    {
        departmentCode: 'CAR',
        departmentName: 'Trung tâm Tim mạch',
        description: 'Khám, tầm soát và điều trị bệnh lý tim mạch, tăng huyết áp, rối loạn mỡ máu',
        roomLocation: 'Tầng 3 - Phòng 301',
        isActive: true,
        symptomKeywords: [
            'đau ngực', 'tức ngực', 'nặng ngực', 'đau thắt ngực', 'đau tức ngực trái', 'tim đập nhanh',
            'tim đập không đều', 'hồi hộp', 'đánh trống ngực', 'rối loạn nhịp tim', 'nhịp tim nhanh', 'nhịp tim chậm',
            'khó thở khi gắng sức', 'khó thở khi leo cầu thang', 'khó thở khi leo thang', 'khó thở khi đi bộ', 'khó thở khi vận động',
            'khó thở khi nằm', 'khó thở về đêm', 'hụt hơi khi leo cầu thang', 'phù chân',
            'huyết áp cao', 'tăng huyết áp', 'huyết áp thấp', 'hạ huyết áp', 'huyết áp không ổn định', 'hẹp van tim',
            'suy tim', 'mỡ máu cao', 'rối loạn mỡ máu', 'cholesterol cao', 'tầm soát tim mạch', 'khám tim',
            'khám tim mạch', 'siêu âm tim', 'điện tim', 'đo holter',
        ],
    },
    {
        departmentCode: 'VAS',
        departmentName: 'Trung tâm Ngoại Lồng ngực - Mạch máu',
        description: 'Khám và phẫu thuật bệnh lý mạch máu ngoại biên, lồng ngực',
        roomLocation: 'Tầng 3 - Phòng 302',
        isActive: true,
        symptomKeywords: [
            'giãn tĩnh mạch', 'giãn tĩnh mạch chân', 'suy tĩnh mạch', 'suy giãn tĩnh mạch', 'phình động mạch',
            'tắc động mạch chi', 'đau chân khi đi bộ', 'chân lạnh tím tái', 'khám mạch máu', 'u trung thất',
        ],
    },
    {
        departmentCode: 'NEU',
        departmentName: 'Trung tâm Khoa học Thần kinh',
        description: 'Chẩn đoán và điều trị bệnh lý thần kinh: đau đầu, chóng mặt - rối loạn tiền đình, đột quỵ, động kinh, sa sút trí tuệ, rối loạn giấc ngủ',
        roomLocation: 'Tầng 3 - Phòng 303',
        isActive: true,
        symptomKeywords: [
            'đau đầu', 'nhức đầu', 'đau nửa đầu', 'migraine', 'đau đầu kéo dài', 'chóng mặt', 'hoa mắt chóng mặt',
            'choáng váng', 'chóng mặt kéo dài', 'rối loạn tiền đình', 'tiền đình', 'quay cuồng', 'tê tay chân',
            'tê bì tay chân', 'tê bì', 'châm chích tay chân', 'mất ngủ', 'khó ngủ', 'ngủ không sâu giấc',
            'rối loạn giấc ngủ', 'run tay', 'run chân', 'run tay chân', 'parkinson', 'mất trí nhớ', 'hay quên',
            'suy giảm trí nhớ', 'sa sút trí tuệ', 'alzheimer', 'động kinh', 'đau dây thần kinh', 'đau thần kinh tam thoa',
            'khám thần kinh',
        ],
    },
    {
        departmentCode: 'MSK',
        departmentName: 'Khoa Cơ xương khớp',
        description: 'Điều trị nội khoa các bệnh cơ - xương - khớp: thoái hóa, viêm khớp, gút, loãng xương, đau lưng - cổ vai gáy',
        roomLocation: 'Tầng 2 - Phòng 204',
        isActive: true,
        symptomKeywords: [
            'đau khớp', 'đau nhức khớp', 'sưng khớp', 'sưng đau khớp', 'cứng khớp buổi sáng', 'đau khớp gối',
            'thoái hóa khớp', 'thoái hóa khớp gối', 'viêm khớp', 'viêm khớp dạng thấp', 'bệnh gút', 'gút',
            'gout', 'đau khớp ngón chân cái', 'loãng xương', 'đau nhức xương', 'đau xương', 'đau cơ', 'đau mỏi cơ',
            'đau lưng', 'đau thắt lưng', 'đau lưng mãn tính', 'đau cột sống', 'thoái hóa cột sống', 'đau vai gáy',
            'đau cổ vai gáy', 'đau mỏi vai gáy', 'khám xương khớp', 'khám cơ xương khớp',
        ],
    },
    {
        departmentCode: 'IMM',
        departmentName: 'Khoa Miễn dịch Lâm sàng',
        description: 'Chẩn đoán, điều trị dị ứng và các bệnh tự miễn',
        roomLocation: 'Tầng 2 - Phòng 205',
        isActive: true,
        symptomKeywords: [
            'dị ứng', 'dị ứng thức ăn', 'dị ứng hải sản', 'dị ứng thuốc', 'dị ứng phấn hoa', 'dị ứng thời tiết',
            'dị ứng bụi', 'test dị ứng', 'thử test dị ứng', 'xét nghiệm dị nguyên', 'mề đay mạn tính', 'phù mạch',
            'bệnh tự miễn', 'lupus', 'lupus ban đỏ', 'xơ cứng bì', 'viêm mạch', 'khám miễn dịch',
        ],
    },

    // ───────────── Ngoại khoa / Chấn thương ─────────────
    {
        departmentCode: 'SUR',
        departmentName: 'Khoa Ngoại Tổng hợp',
        description: 'Phẫu thuật và can thiệp ngoại khoa: ruột thừa, thoát vị, trĩ, các khối u lành tính phần mềm',
        roomLocation: 'Tầng 4 - Phòng 401',
        isActive: true,
        symptomKeywords: [
            'đau ruột thừa', 'viêm ruột thừa', 'đau bụng dưới bên phải', 'mổ ruột thừa', 'thoát vị bẹn', 'thoát vị rốn',
            'thoát vị thành bụng', 'khối phồng ở bẹn', 'trĩ', 'bệnh trĩ', 'búi trĩ', 'nứt kẽ hậu môn', 'rò hậu môn',
            'đau rát hậu môn', 'đau hậu môn', 'áp xe', 'nhọt', 'u mỡ', 'khối u dưới da', 'bướu mỡ', 'cắt túi mật',
            'mổ túi mật', 'cần phẫu thuật', 'cần mổ', 'tư vấn phẫu thuật', 'khám ngoại', 'khám ngoại tổng quát',
        ],
    },
    {
        departmentCode: 'ORT',
        departmentName: 'Khoa Phẫu thuật khớp và Nội soi',
        description: 'Chấn thương chỉnh hình, y học thể thao, phẫu thuật nội soi và thay khớp',
        roomLocation: 'Tầng 4 - Phòng 402',
        isActive: true,
        symptomKeywords: [
            'gãy xương', 'nứt xương', 'trật khớp', 'bong gân', 'giãn dây chằng', 'đứt dây chằng', 'rách dây chằng chéo',
            'rách sụn chêm', 'chấn thương thể thao', 'chấn thương đầu gối', 'tổn thương khớp gối', 'đau khớp vai',
            'rách chóp xoay', 'chấn thương vai', 'thay khớp', 'thay khớp gối', 'thay khớp háng', 'nội soi khớp',
            'khám chấn thương chỉnh hình',
        ],
    },
    {
        departmentCode: 'SPN',
        departmentName: 'Khoa Ngoại Thần kinh - Cột sống',
        description: 'Phẫu thuật và điều trị can thiệp bệnh lý cột sống, tủy sống, u não',
        roomLocation: 'Tầng 4 - Phòng 403',
        isActive: true,
        symptomKeywords: [
            'thoát vị đĩa đệm', 'đau lưng lan xuống chân', 'đau thần kinh tọa', 'hẹp ống sống', 'trượt đốt sống',
            'đau cổ lan xuống tay', 'chèn ép tủy', 'u cột sống', 'gù vẹo cột sống', 'vẹo cột sống', 'phẫu thuật cột sống',
            'u não', 'u tủy', 'khám ngoại thần kinh', 'khám cột sống',
        ],
    },
    {
        departmentCode: 'URO',
        departmentName: 'Trung tâm Tiết niệu - Thận học - Nam khoa',
        description: 'Khám và điều trị bệnh lý thận, đường tiết niệu và nam khoa',
        roomLocation: 'Tầng 3 - Phòng 304',
        isActive: true,
        symptomKeywords: [
            'tiểu buốt', 'tiểu rắt', 'tiểu khó', 'tiểu đêm nhiều', 'tiểu nhiều lần', 'tiểu ra máu', 'nước tiểu có máu',
            'tiểu đục', 'tiểu ra bọt', 'tiểu không tự chủ', 'són tiểu', 'bí tiểu', 'nhiễm trùng tiểu',
            'nhiễm trùng đường tiết niệu', 'viêm bàng quang', 'viêm đường tiết niệu', 'đau hông lưng', 'đau quặn thận',
            'sỏi thận', 'sỏi niệu quản', 'sỏi bàng quang', 'sỏi tiết niệu', 'suy thận', 'bệnh thận', 'thận ứ nước',
            'phì đại tuyến tiền liệt', 'tuyến tiền liệt', 'rối loạn cương dương', 'yếu sinh lý', 'xuất tinh sớm',
            'tinh trùng yếu', 'tinh trùng ít', 'giãn tĩnh mạch thừng tinh', 'đau tinh hoàn', 'sưng tinh hoàn',
            'hẹp bao quy đầu', 'viêm bao quy đầu', 'cắt bao quy đầu', 'nam khoa', 'khám nam khoa', 'khám tiết niệu',
        ],
    },
    {
        departmentCode: 'ONC',
        departmentName: 'Trung tâm Ung bướu',
        description: 'Tầm soát, chẩn đoán và điều trị ung thư; khám các khối u, hạch bất thường',
        roomLocation: 'Tầng 5 - Phòng 501',
        isActive: true,
        symptomKeywords: [
            'khối u', 'sờ thấy khối u', 'nổi hạch', 'sờ thấy hạch', 'hạch to', 'nổi hạch cổ', 'nổi cục', 'u vú',
            'nổi cục ở vú', 'đau vú', 'tiết dịch núm vú', 'khám vú', 'ung thư', 'nghi ung thư', 'tầm soát ung thư',
            'ung thư vú', 'ung thư phổi', 'ung thư gan', 'ung thư đại tràng', 'ung thư tuyến giáp', 'sinh thiết',
            'hóa trị', 'xạ trị', 'khám ung bướu',
        ],
    },

    // ───────────── Sản - Phụ - Hiếm muộn - Nhi ─────────────
    {
        departmentCode: 'OBG',
        departmentName: 'Trung tâm Sản Phụ khoa',
        description: 'Khám thai, sinh nở, khám và điều trị bệnh lý phụ khoa',
        roomLocation: 'Tầng 6 - Phòng 601',
        isActive: true,
        symptomKeywords: [
            'mang thai', 'có thai', 'thử thai lên hai vạch', 'trễ kinh', 'chậm kinh', 'khám thai', 'siêu âm thai',
            'thai kỳ', 'thai nghén', 'ốm nghén', 'nghén nặng', 'buồn nôn khi mang thai', 'đau bụng khi mang thai',
            'dọa sảy thai', 'sảy thai', 'thai lưu', 'ra huyết âm đạo', 'ra máu âm đạo bất thường', 'rong kinh',
            'rong huyết', 'kinh nguyệt không đều', 'rối loạn kinh nguyệt', 'kinh nguyệt ra nhiều', 'vô kinh',
            'đau bụng kinh', 'thống kinh', 'khí hư', 'khí hư bất thường', 'huyết trắng', 'ngứa vùng kín', 'viêm âm đạo',
            'viêm phụ khoa', 'đau vùng chậu', 'u xơ tử cung', 'u nang buồng trứng', 'buồng trứng đa nang',
            'polyp cổ tử cung', 'tầm soát ung thư cổ tử cung', 'khám phụ khoa', 'mãn kinh', 'tiền mãn kinh', 'bốc hỏa',
            'sinh mổ', 'sinh thường', 'sau sinh', 'tắc tia sữa', 'mất sữa', 'đặt vòng', 'tránh thai', 'khám tiền hôn nhân',
            'khám sản', 'khám sản phụ khoa',
        ],
    },
    {
        departmentCode: 'FMD',
        departmentName: 'Trung tâm Y học Bào thai',
        description: 'Sàng lọc và chẩn đoán trước sinh, tầm soát dị tật thai nhi, theo dõi thai nguy cơ cao',
        roomLocation: 'Tầng 6 - Phòng 602',
        isActive: true,
        symptomKeywords: [
            'sàng lọc dị tật thai', 'dị tật thai nhi', 'dị tật bẩm sinh', 'tầm soát dị tật', 'nipt', 'double test',
            'triple test', 'siêu âm hình thái thai', 'siêu âm thai 4d', 'chọc ối', 'thai chậm phát triển',
            'thai kém phát triển', 'thai nhi nhỏ', 'đa ối', 'ối ít', 'thai nguy cơ cao', 'sàng lọc trước sinh',
        ],
    },
    {
        departmentCode: 'IVF',
        departmentName: 'Trung tâm Hỗ trợ sinh sản',
        description: 'Điều trị hiếm muộn, thụ tinh ống nghiệm (IVF), IUI, trữ đông trứng - tinh trùng - phôi',
        roomLocation: 'Tầng 7 - Phòng 701',
        isActive: true,
        symptomKeywords: [
            'hiếm muộn', 'vô sinh', 'vô sinh hiếm muộn', 'khó có con', 'chưa có con', 'muốn có con',
            'thụ tinh ống nghiệm', 'ivf', 'iui', 'bơm tinh trùng', 'trữ đông trứng', 'trữ đông tinh trùng',
            'trữ đông phôi', 'xin tinh trùng', 'xin trứng', 'rối loạn phóng noãn', 'kích thích buồng trứng',
            'khám hiếm muộn',
        ],
    },
    {
        departmentCode: 'PED',
        departmentName: 'Khoa Nhi',
        description: 'Khám và điều trị các bệnh thường gặp ở trẻ em; theo dõi tăng trưởng - phát triển',
        roomLocation: 'Tầng 1 - Phòng 102',
        isActive: true,
        symptomKeywords: [
            'khoa nhi', 'khám nhi', 'khám cho bé', 'khám cho con', 'trẻ em', 'trẻ nhỏ', 'trẻ sốt', 'bé sốt', 'con sốt',
            'trẻ ho', 'bé ho', 'con ho', 'trẻ biếng ăn', 'bé biếng ăn', 'con biếng ăn', 'trẻ chậm tăng cân',
            'trẻ chậm lớn', 'bé chậm nói', 'trẻ chậm nói', 'trẻ quấy khóc', 'bé quấy khóc', 'bé khóc đêm',
            'trẻ tiêu chảy', 'bé tiêu chảy', 'trẻ nôn trớ', 'bé nôn trớ', 'trớ sữa', 'trẻ táo bón', 'bé táo bón',
            'trẻ phát ban', 'bé phát ban', 'sốt phát ban', 'tay chân miệng', 'quai bị', 'sởi', 'thủy đậu',
            'viêm tiểu phế quản', 'trẻ suy dinh dưỡng', 'bé thấp còi', 'trẻ còi xương', 'trẻ hay ốm vặt',
            'trẻ dậy thì sớm', 'bé dậy thì sớm', 'trẻ đái dầm', 'bé tè dầm',
        ],
    },
    {
        departmentCode: 'NEO',
        departmentName: 'Trung tâm Sơ sinh',
        description: 'Chăm sóc và điều trị trẻ sơ sinh, trẻ sinh non, sinh nhẹ cân',
        roomLocation: 'Tầng 6 - Phòng 603',
        isActive: true,
        symptomKeywords: [
            'sơ sinh', 'trẻ sơ sinh', 'bé sơ sinh', 'bé mới sinh', 'trẻ mới sinh', 'vàng da sơ sinh', 'bé vàng da',
            'trẻ vàng da', 'sinh non', 'trẻ sinh non', 'bé sinh non', 'sinh thiếu tháng', 'bé bú kém', 'bé bú ít',
            'bé không chịu bú', 'trẻ bú kém', 'rốn chưa rụng', 'nhiễm trùng rốn', 'sàng lọc sơ sinh', 'bé nhẹ cân',
            'khám sơ sinh',
        ],
    },
    {
        departmentCode: 'VAC',
        departmentName: 'Trung tâm Tiêm chủng',
        description: 'Tiêm chủng vắc xin cho trẻ em và người lớn',
        roomLocation: 'Tầng 1 - Phòng 103',
        isActive: true,
        symptomKeywords: [
            'tiêm chủng', 'tiêm vắc xin', 'tiêm vaccine', 'tiêm vacxin', 'tiêm phòng', 'tiêm ngừa', 'lịch tiêm chủng',
            'tiêm phòng cúm', 'tiêm ngừa cúm', 'tiêm ngừa hpv', 'tiêm phòng hpv', 'tiêm ngừa phế cầu',
            'tiêm phòng viêm gan b', 'tiêm phòng dại', 'tiêm phòng uốn ván', 'tiêm phòng cho bé', 'tiêm ngừa zona',
            'tiêm phòng thủy đậu', 'tiêm ngừa não mô cầu', 'vắc xin 6 trong 1', 'vắc xin 5 trong 1',
        ],
    },

    // ───────────── Chuyên khoa đơn lẻ ─────────────
    {
        departmentCode: 'ENT',
        departmentName: 'Trung tâm Tai Mũi Họng',
        description: 'Khám và điều trị bệnh lý tai, mũi, họng, thanh quản và vùng đầu cổ',
        roomLocation: 'Tầng 3 - Phòng 305',
        isActive: true,
        symptomKeywords: [
            'đau họng', 'viêm họng', 'rát họng', 'ngứa họng', 'vướng họng', 'nuốt vướng', 'nuốt đau', 'khàn tiếng',
            'khàn giọng', 'mất tiếng', 'viêm amidan', 'sưng amidan', 'amidan', 'nghẹt mũi', 'ngạt mũi', 'sổ mũi',
            'chảy nước mũi', 'hắt hơi', 'viêm mũi', 'viêm mũi dị ứng', 'viêm xoang', 'đau xoang', 'chảy máu cam',
            'polyp mũi', 'vẹo vách ngăn', 'ù tai', 'đau tai', 'viêm tai', 'viêm tai giữa', 'chảy mủ tai', 'nghe kém',
            'giảm thính lực', 'điếc đột ngột', 'ráy tai', 'ngáy to', 'u tuyến nước bọt', 'nội soi tai mũi họng',
            'khám tai mũi họng',
        ],
    },
    {
        departmentCode: 'OPH',
        departmentName: 'Trung tâm Mắt Công nghệ cao',
        description: 'Khám và điều trị bệnh lý mắt; phẫu thuật khúc xạ, đục thủy tinh thể, võng mạc',
        roomLocation: 'Tầng 5 - Phòng 502',
        isActive: true,
        symptomKeywords: [
            'đau mắt', 'đau mắt đỏ', 'mắt đỏ', 'đỏ mắt', 'ngứa mắt', 'chảy nước mắt', 'nhức mắt', 'đau nhức mắt',
            'khô mắt', 'mỏi mắt', 'mờ mắt', 'mắt mờ', 'nhìn mờ', 'giảm thị lực', 'nhìn đôi', 'thấy ruồi bay',
            'thấy đốm đen', 'cận thị', 'viễn thị', 'loạn thị', 'lão thị', 'mổ cận', 'phẫu thuật cận thị', 'lasik',
            'lẹo mắt', 'chắp mắt', 'mắt có ghèn', 'sụp mí', 'đục thủy tinh thể', 'cườm khô', 'cườm nước',
            'tăng nhãn áp', 'glocom', 'thoái hóa hoàng điểm', 'bong võng mạc', 'khám mắt', 'đo thị lực',
        ],
    },
    {
        departmentCode: 'DEN',
        departmentName: 'Khoa Răng Hàm Mặt',
        description: 'Khám và điều trị răng miệng, nha khoa thẩm mỹ, phẫu thuật hàm mặt',
        roomLocation: 'Tầng 5 - Phòng 503',
        isActive: true,
        symptomKeywords: [
            'đau răng', 'nhức răng', 'sâu răng', 'răng sâu', 'viêm nướu', 'viêm lợi', 'chảy máu chân răng', 'sưng nướu',
            'sưng lợi', 'răng khôn', 'mọc răng khôn', 'nhổ răng', 'nhổ răng khôn', 'trám răng', 'bọc răng sứ', 'răng sứ',
            'niềng răng', 'chỉnh nha', 'cạo vôi răng', 'lấy cao răng', 'tẩy trắng răng', 'trồng răng', 'implant',
            'ê buốt răng', 'hôi miệng', 'mẻ răng', 'gãy răng', 'áp xe răng', 'khớp thái dương hàm', 'đau hàm',
            'khám răng',
        ],
    },
    {
        departmentCode: 'DER',
        departmentName: 'Khoa Da liễu - Thẩm mỹ da',
        description: 'Khám và điều trị bệnh da, tóc, móng; chăm sóc và thẩm mỹ da',
        roomLocation: 'Tầng 5 - Phòng 504',
        isActive: true,
        symptomKeywords: [
            'nổi mẩn', 'nổi mẩn đỏ', 'nổi mề đay', 'mề đay', 'ngứa da', 'ngứa khắp người', 'phát ban', 'nổi ban đỏ',
            'mụn', 'mụn trứng cá', 'mụn nhọt', 'nám', 'tàn nhang', 'sạm da', 'viêm da', 'viêm da cơ địa', 'chàm',
            'eczema', 'vảy nến', 'nấm da', 'nấm móng', 'nấm bẹn', 'hắc lào', 'ghẻ', 'zona', 'giời leo', 'mụn rộp',
            'mụn cóc', 'sẹo', 'sẹo lồi', 'rụng tóc', 'rụng tóc nhiều', 'hói', 'gàu', 'nấm da đầu', 'viêm nang lông',
            'da khô', 'bong tróc da', 'bạch biến', 'lang ben', 'loét da', 'vết thương lâu lành', 'chăm sóc da',
            'trị mụn', 'trị nám', 'laser trị sẹo', 'laser trị nám', 'trẻ hóa da', 'tiêm botox', 'tiêm filler',
            'khám da liễu',
        ],
    },

    // ───────────── Dinh dưỡng - Phục hồi chức năng ─────────────
    {
        departmentCode: 'WGT',
        departmentName: 'Kiểm soát cân nặng và Điều trị béo phì',
        description: 'Tư vấn và điều trị thừa cân, béo phì; can thiệp giảm cân',
        roomLocation: 'Tầng 2 - Phòng 206',
        isActive: true,
        symptomKeywords: [
            'béo phì', 'thừa cân', 'muốn giảm cân', 'giảm cân', 'tăng cân nhanh', 'tăng cân không kiểm soát', 'giảm béo',
            'phẫu thuật giảm béo', 'thu nhỏ dạ dày', 'đặt bóng dạ dày', 'kiểm soát cân nặng', 'bmi cao',
        ],
    },
    {
        departmentCode: 'NUT',
        departmentName: 'Khoa Dinh dưỡng Tiết chế',
        description: 'Tư vấn dinh dưỡng và chế độ ăn điều trị cho người bệnh và người khỏe mạnh',
        roomLocation: 'Tầng 2 - Phòng 207',
        isActive: true,
        symptomKeywords: [
            'tư vấn dinh dưỡng', 'chế độ ăn', 'thực đơn', 'chế độ ăn cho người tiểu đường', 'suy dinh dưỡng',
            'thiếu dinh dưỡng', 'thiếu vitamin', 'ăn kiêng', 'dinh dưỡng cho bà bầu', 'dinh dưỡng sau mổ',
            'khám dinh dưỡng',
        ],
    },
    {
        departmentCode: 'REH',
        departmentName: 'Khoa Phục hồi chức năng',
        description: 'Vật lý trị liệu và phục hồi chức năng sau chấn thương, phẫu thuật, đột quỵ',
        roomLocation: 'Tầng 1 - Phòng 104',
        isActive: true,
        symptomKeywords: [
            'phục hồi chức năng', 'vật lý trị liệu', 'tập vật lý trị liệu', 'tập phục hồi', 'phục hồi sau mổ',
            'phục hồi sau đột quỵ', 'phục hồi sau tai biến', 'phục hồi sau chấn thương', 'di chứng đột quỵ',
            'di chứng tai biến', 'di chứng chấn thương', 'tập đi lại', 'trị liệu ngôn ngữ', 'kéo giãn cột sống',
            'sóng xung kích', 'tập vận động',
        ],
    },

    // ───────────── Cấp cứu ─────────────
    {
        departmentCode: 'ER',
        departmentName: 'Khoa Cấp cứu Tổng hợp',
        description: 'Tiếp nhận và xử trí cấp cứu 24/7: tai nạn, chấn thương, ngộ độc và các tình trạng nguy kịch',
        roomLocation: 'Tầng G - Phòng 001',
        isActive: true,
        symptomKeywords: [
            'cấp cứu', 'cần cấp cứu', 'tai nạn', 'tai nạn giao thông', 'tai nạn lao động', 'tai nạn sinh hoạt', 'té ngã',
            'bị ngã', 'ngã đập đầu', 'chấn thương', 'chấn thương nặng', 'vết thương hở', 'vết thương chảy máu',
            'vết cắt sâu', 'khâu vết thương', 'bị bỏng', 'bỏng nước sôi', 'bỏng dầu', 'bỏng lửa', 'bị điện giật',
            'bị chó cắn', 'bị mèo cắn', 'bị rắn cắn', 'bị ong đốt', 'côn trùng cắn', 'hóc xương', 'hóc dị vật',
            'nuốt dị vật', 'ngộ độc', 'ngộ độc thực phẩm', 'say nắng', 'sốc nhiệt', 'đuối nước', 'ngất', 'ngất xỉu',
            'xỉu', 'bất tỉnh',
        ],
    },
];

/**
 * Kiểm tra toàn vẹn dữ liệu seed — fail sớm khi seed, thay vì để lỗi dữ liệu lặng lẽ làm sai kết quả gợi ý.
 * Trả về danh sách lỗi (rỗng = hợp lệ).
 */
function validateDepartmentSeed(items: DepartmentSeedItem[]): string[] {
    const errors: string[] = [];
    const codes = new Set<string>();
    const names = new Set<string>();
    // Khoá so sánh: bỏ dấu + lowercase. Chỉ dùng để phát hiện trùng, không dùng để so khớp lúc chạy.
    const identity = (s: string) =>
        s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').toLowerCase().trim().replace(/\s+/g, ' ');
    const keywordOwner = new Map<string, string>();

    for (const item of items) {
        if (!/^[A-Z]{2,5}$/.test(item.departmentCode)) errors.push(`Mã khoa không hợp lệ: "${item.departmentCode}"`);
        if (codes.has(item.departmentCode)) errors.push(`Trùng mã khoa: ${item.departmentCode}`);
        codes.add(item.departmentCode);

        const nameKey = identity(item.departmentName);
        if (names.has(nameKey)) errors.push(`Trùng tên khoa: ${item.departmentName}`);
        names.add(nameKey);

        if (item.symptomKeywords.length === 0) errors.push(`${item.departmentCode}: chưa có từ khoá triệu chứng`);

        const seenInDept = new Set<string>();
        for (const raw of item.symptomKeywords) {
            const key = identity(raw);
            if (!key) {
                errors.push(`${item.departmentCode}: từ khoá rỗng`);
                continue;
            }
            if (raw !== raw.trim() || raw !== raw.toLowerCase()) {
                errors.push(`${item.departmentCode}: từ khoá "${raw}" phải là chữ thường, không thừa khoảng trắng`);
            }
            if (seenInDept.has(key)) errors.push(`${item.departmentCode}: từ khoá lặp trong cùng khoa: "${raw}"`);
            seenInDept.add(key);

            const owner = keywordOwner.get(key);
            if (owner && owner !== item.departmentCode) {
                errors.push(`Từ khoá "${raw}" trùng giữa ${owner} và ${item.departmentCode}`);
            } else {
                keywordOwner.set(key, item.departmentCode);
            }
        }
    }
    return errors;
}

export async function seedDepartments(prisma: PrismaService): Promise<void> {
    const errors = validateDepartmentSeed(DEPARTMENT_SEED);
    if (errors.length > 0) {
        throw new Error(`Dữ liệu seed khoa không hợp lệ:\n - ${errors.join('\n - ')}`);
    }

    // Vẫn giữ atomic: lỗi giữa chừng thì rollback toàn bộ.
    // timeout mặc định 5s không đủ khi DB ở xa (mỗi upsert ~200ms x 29 khoa).
    await prisma.$transaction(
        async (tx) => {
            await Promise.all(
                DEPARTMENT_SEED.map((item) =>
                    tx.department.upsert({
                        where: { departmentCode: item.departmentCode },
                        update: {
                            departmentName: item.departmentName,
                            description: item.description,
                            roomLocation: item.roomLocation,
                            isActive: item.isActive,
                            symptomKeywords: item.symptomKeywords,
                        },
                        create: item,
                    })
                )
            );
        },
        { maxWait: 10_000, timeout: 15_000 },
    );

    const count = await prisma.department.count();
    console.log(`Seeded departments (${DEPARTMENT_SEED.length} khoa trong seed), total in DB: ${count}`);
}
