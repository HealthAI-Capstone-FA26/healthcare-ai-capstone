import { PrismaService } from 'prisma/prisma.service';

export async function seedDepartments(prisma: PrismaService): Promise<void> {
    const departments = [
        {
            departmentCode: 'IM',
            departmentName: 'Khoa Nội',
            description: 'Chẩn đoán và điều trị bệnh nội khoa',
            roomLocation: 'Tầng 1 - Phòng 101',
            isActive: true,
        },
        {
            departmentCode: 'SUR',
            departmentName: 'Khoa Ngoại',
            description: 'Phẫu thuật và can thiệp ngoại khoa',
            roomLocation: 'Tầng 2 - Phòng 201',
            isActive: true,
        },
        {
            departmentCode: 'PED',
            departmentName: 'Khoa Nhi',
            description: 'Chăm sóc và điều trị trẻ em',
            roomLocation: 'Tầng 1 - Phòng 102',
            isActive: true,
        },
        {
            departmentCode: 'OBG',
            departmentName: 'Khoa Sản',
            description: 'Sản phụ khoa và chăm sóc thai sản',
            roomLocation: 'Tầng 3 - Phòng 301',
            isActive: true,
        },
        {
            departmentCode: 'CAR',
            departmentName: 'Khoa Tim Mạch',
            description: 'Khám và điều trị bệnh tim mạch',
            roomLocation: 'Tầng 2 - Phòng 202',
            isActive: true,
        },
        {
            departmentCode: 'NEU',
            departmentName: 'Khoa Thần Kinh',
            description: 'Chẩn đoán và điều trị các bệnh thần kinh',
            roomLocation: 'Tầng 3 - Phòng 302',
            isActive: true,
        },
        {
            departmentCode: 'ORT',
            departmentName: 'Khoa Chấn Thương Chỉnh Hình',
            description: 'Điều trị các vấn đề xương khớp và chấn thương',
            roomLocation: 'Tầng 2 - Phòng 203',
            isActive: true,
        },
        {
            departmentCode: 'ER',
            departmentName: 'Khoa Cấp Cứu',
            description: 'Hỗ trợ y tế khẩn cấp và tai nạn',
            roomLocation: 'Tầng G - Phòng 001',
            isActive: true,
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
            },
            create: item,
        });
    }

    const count = await prisma.department.count();
    console.log(`Seeded departments, total in DB: ${count}`);
}