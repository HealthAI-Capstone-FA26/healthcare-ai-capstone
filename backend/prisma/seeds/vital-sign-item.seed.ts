import { PrismaClient } from '@prisma/client';

export async function seedVitalSignItems(prisma: PrismaClient) {
    const items = [
        { itemCode: 'HR', itemName: 'Nhịp tim / Mạch', loincCode: '8867-4', unit: 'bpm', isCalculated: false, isActive: true },
        { itemCode: 'SBP', itemName: 'Huyết áp Tâm thu', loincCode: '8480-6', unit: 'mmHg', isCalculated: false, isActive: true },
        { itemCode: 'DBP', itemName: 'Huyết áp Tâm trương', loincCode: '8462-4', unit: 'mmHg', isCalculated: false, isActive: true },
        { itemCode: 'RR', itemName: 'Nhịp thở', loincCode: '9279-1', unit: 'breaths/min', isCalculated: false, isActive: true },
        { itemCode: 'SPO2', itemName: 'Nồng độ Oxy trong máu', loincCode: '2708-6', unit: '%', isCalculated: false, isActive: true },
        { itemCode: 'TEMP', itemName: 'Thân nhiệt', loincCode: '8310-5', unit: '°C', isCalculated: false, isActive: true },
        { itemCode: 'HEIGHT', itemName: 'Chiều cao', loincCode: '8302-2', unit: 'cm', isCalculated: false, isActive: true },
        { itemCode: 'WEIGHT', itemName: 'Cân nặng', loincCode: '29463-7', unit: 'kg', isCalculated: false, isActive: true },
        { itemCode: 'BMI', itemName: 'Chỉ số khối cơ thể (BMI)', loincCode: '39156-5', unit: 'kg/m2', isCalculated: true, isActive: true },
    ];

    for (const item of items) {
        await prisma.vitalSignItem.upsert({
            where: { itemCode: item.itemCode },
            update: {
                itemName: item.itemName,
                loincCode: item.loincCode,
                unit: item.unit,
                isCalculated: item.isCalculated,
                isActive: item.isActive,
            },
            create: item,
        });
    }

    const count = await prisma.vitalSignItem.count();
    console.log(`Seeded vital sign items, total in DB: ${count}`);
}