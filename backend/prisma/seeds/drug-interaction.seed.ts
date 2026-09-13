import { PrismaService } from 'prisma/prisma.service';

export async function seedDrugInteractions(prisma: PrismaService): Promise<void> {
    const drugs = await prisma.drugCatalog.findMany();
    const drugMap = new Map(drugs.map((d) => [d.drugCode, d.drugId]));

    const interactions = [
        {
            drugCodeA: 'ASP81',
            drugCodeB: 'IBU400',
            severity: 'severe',
            description:
                'Dùng đồng thời Ibuprofen với Aspirin liều thấp có thể làm giảm tác dụng kháng kết tập tiểu cầu ' +
                'của Aspirin và tăng nguy cơ xuất huyết tiêu hóa.',
        },
        {
            drugCodeA: 'IBU400',
            drugCodeB: 'DICLO50',
            severity: 'moderate',
            description:
                'Phối hợp 2 NSAID cùng lúc không tăng hiệu quả giảm đau mà tăng nguy cơ loét dạ dày - tá tràng ' +
                'và độc tính trên thận.',
        },
        {
            drugCodeA: 'ASP81',
            drugCodeB: 'DICLO50',
            severity: 'moderate',
            description:
                'Diclofenac dùng cùng Aspirin liều thấp có thể làm giảm tác dụng bảo vệ tim mạch của Aspirin ' +
                'và tăng nguy cơ tác dụng phụ trên đường tiêu hóa.',
        },
        {
            drugCodeA: 'METF500',
            drugCodeB: 'IBU400',
            severity: 'moderate',
            description:
                'NSAID có thể làm giảm chức năng thận, dẫn tới tích lũy Metformin và tăng nguy cơ toan lactic.',
        },
        {
            drugCodeA: 'OMEP20',
            drugCodeB: 'METF500',
            severity: 'mild',
            description:
                'Dùng PPI kéo dài cùng Metformin có thể ảnh hưởng hấp thu vitamin B12, cần theo dõi khi điều trị dài ngày.',
        },
    ];

    for (const i of interactions) {
        const drugIdA = drugMap.get(i.drugCodeA);
        const drugIdB = drugMap.get(i.drugCodeB);
        if (!drugIdA || !drugIdB) continue;

        await prisma.drugInteraction.upsert({
            where: { drugIdA_drugIdB: { drugIdA, drugIdB } },
            update: { severity: i.severity, description: i.description, isActive: true },
            create: {
                drugIdA,
                drugIdB,
                severity: i.severity,
                description: i.description,
                isActive: true,
            },
        });
    }

    const count = await prisma.drugInteraction.count();
    console.log(`Seeded drug interactions, total in DB: ${count}`);
}
