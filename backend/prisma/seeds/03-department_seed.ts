import { PrismaService } from 'prisma/prisma.service';

export async function seedDepartments(prisma: PrismaService): Promise<void> {
    const departments = [
        {
            departmentCode: 'IM',
            departmentName: 'Khoa Nội',
            description: 'Chẩn đoán và điều trị bệnh nội khoa',
            roomLocation: 'Tầng 1 - Phòng 101',
            isActive: true,
            symptomKeywords: [
                'sốt', 'ho', 'cảm cúm', 'đau họng', 'mệt mỏi', 'chán ăn',
                'đau bụng', 'tiêu chảy', 'đau dạ dày', 'khó tiêu', 'ợ chua',
                'chóng mặt', 'huyết áp cao', 'tiểu đường', 'khám tổng quát',
            ],
        },
        {
            departmentCode: 'SUR',
            departmentName: 'Khoa Ngoại',
            description: 'Phẫu thuật và can thiệp ngoại khoa',
            roomLocation: 'Tầng 2 - Phòng 201',
            isActive: true,
            symptomKeywords: [
                'đau ruột thừa', 'thoát vị', 'u bướu', 'áp xe', 'vết thương hở',
                'cần phẫu thuật', 'sỏi mật', 'sỏi thận', 'trĩ', 'bỏng',
            ],
        },
        {
            departmentCode: 'PED',
            departmentName: 'Khoa Nhi',
            description: 'Chăm sóc và điều trị trẻ em',
            roomLocation: 'Tầng 1 - Phòng 102',
            isActive: true,
            symptomKeywords: [
                'trẻ sốt', 'trẻ ho', 'bé sốt', 'bé ho', 'trẻ biếng ăn',
                'tiêm chủng cho bé', 'bé quấy khóc', 'trẻ tiêu chảy', 'trẻ sơ sinh',
                'trẻ em', 'phát ban ở trẻ',
            ],
        },
        {
            departmentCode: 'OBG',
            departmentName: 'Khoa Sản',
            description: 'Sản phụ khoa và chăm sóc thai sản',
            roomLocation: 'Tầng 3 - Phòng 301',
            isActive: true,
            symptomKeywords: [
                'mang thai', 'khám thai', 'chậm kinh', 'kinh nguyệt không đều',
                'đau bụng kinh', 'ra huyết âm đạo', 'khí hư bất thường', 'sinh nở',
                'vô sinh hiếm muộn', 'đau vùng chậu',
            ],
        },
        {
            departmentCode: 'CAR',
            departmentName: 'Khoa Tim Mạch',
            description: 'Khám và điều trị bệnh tim mạch',
            roomLocation: 'Tầng 2 - Phòng 202',
            isActive: true,
            symptomKeywords: [
                'đau ngực', 'tim đập nhanh', 'hồi hộp', 'khó thở khi gắng sức',
                'huyết áp thấp', 'rối loạn nhịp tim', 'đau thắt ngực', 'hẹp van tim',
            ],
        },
        {
            departmentCode: 'NEU',
            departmentName: 'Khoa Thần Kinh',
            description: 'Chẩn đoán và điều trị các bệnh thần kinh',
            roomLocation: 'Tầng 3 - Phòng 302',
            isActive: true,
            symptomKeywords: [
                'đau đầu', 'đau nửa đầu', 'chóng mặt kéo dài', 'tê tay chân',
                'mất ngủ kéo dài', 'co giật', 'run tay', 'mất trí nhớ', 'động kinh',
            ],
        },
        {
            departmentCode: 'ORT',
            departmentName: 'Khoa Chấn Thương Chỉnh Hình',
            description: 'Điều trị các vấn đề xương khớp và chấn thương',
            roomLocation: 'Tầng 2 - Phòng 203',
            isActive: true,
            symptomKeywords: [
                'đau lưng', 'đau khớp', 'gãy xương', 'trật khớp', 'đau vai gáy',
                'thoát vị đĩa đệm', 'chấn thương thể thao', 'sưng khớp gối', 'đau cột sống',
            ],
        },
        {
            departmentCode: 'ER',
            departmentName: 'Khoa Cấp Cứu',
            description: 'Hỗ trợ y tế khẩn cấp và tai nạn',
            roomLocation: 'Tầng G - Phòng 001',
            isActive: true,
            symptomKeywords: [
                'cấp cứu', 'tai nạn giao thông', 'chấn thương nặng', 'ngất xỉu',
                'khó thở nặng', 'chảy máu nhiều', 'đau ngực dữ dội', 'bất tỉnh', 'ngộ độc',
            ],
        },
    ];

    for (const item of departments) {
        await prisma.department.upsert({
            where: { departmentCode: item.departmentCode },
            update: {
                departmentName: item.departmentName,
                description: item.description,
                roomLocation: item.roomLocation,
                isActive: item.isActive,
                symptomKeywords: item.symptomKeywords,
            },
            create: item,
        });
    }

    const count = await prisma.department.count();
    console.log(`Seeded departments, total in DB: ${count}`);
}