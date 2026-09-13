import { PrismaService } from 'prisma/prisma.service';

export async function seedAllergenCategories(prisma: PrismaService): Promise<void> {
    const categories = [
        { categoryCode: 'PENICILLIN', categoryName: 'Penicillin' },
        { categoryCode: 'SULFA', categoryName: 'Sulfonamide (Sulfa)' },
        { categoryCode: 'NSAID', categoryName: 'NSAID (kháng viêm không steroid)' },
        { categoryCode: 'ASPIRIN', categoryName: 'Aspirin/Salicylate' },
    ];

    for (const item of categories) {
        await prisma.allergenCategory.upsert({
            where: { categoryCode: item.categoryCode },
            update: { categoryName: item.categoryName },
            create: item,
        });
    }

    const count = await prisma.allergenCategory.count();
    console.log(`Seeded allergen categories, total in DB: ${count}`);
}
