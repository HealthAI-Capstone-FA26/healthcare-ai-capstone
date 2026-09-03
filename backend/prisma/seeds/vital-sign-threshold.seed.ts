import { PrismaClient } from '@prisma/client';

export async function seedVitalSignThresholds(prisma: PrismaClient) {
    const items = await prisma.vitalSignItem.findMany();
    const itemMap = new Map(items.map((i) => [i.itemCode, i.itemId]));

    const hrId = itemMap.get('HR');
    const sbpId = itemMap.get('SBP');
    const dbpId = itemMap.get('DBP');
    const rrId = itemMap.get('RR');
    const spo2Id = itemMap.get('SPO2');
    const tempId = itemMap.get('TEMP');

    const effectiveFrom = new Date('2026-01-01');

    const thresholds = [
        // TRẺ SƠ SINH (0 - 1 tuổi)
        { itemId: hrId, ageMin: 0, ageMax: 1, minNormal: 100, maxNormal: 160, minCritical: 80, maxCritical: 180 },
        { itemId: sbpId, ageMin: 0, ageMax: 1, minNormal: 60, maxNormal: 90, minCritical: 50, maxCritical: 100 },
        { itemId: dbpId, ageMin: 0, ageMax: 1, minNormal: 30, maxNormal: 60, minCritical: 25, maxCritical: 70 },
        { itemId: rrId, ageMin: 0, ageMax: 1, minNormal: 30, maxNormal: 60, minCritical: 20, maxCritical: 70 },
        { itemId: spo2Id, ageMin: 0, ageMax: 1, minNormal: 95, maxNormal: 100, minCritical: 90, maxCritical: null },
        { itemId: tempId, ageMin: 0, ageMax: 1, minNormal: 36.5, maxNormal: 37.5, minCritical: 35.5, maxCritical: 38.5 },

        // TRẺ NHỦ NHI & NHỎ (2 - 12 tuổi)
        { itemId: hrId, ageMin: 2, ageMax: 12, minNormal: 80, maxNormal: 130, minCritical: 60, maxCritical: 150 },
        { itemId: sbpId, ageMin: 2, ageMax: 12, minNormal: 80, maxNormal: 110, minCritical: 70, maxCritical: 125 },
        { itemId: dbpId, ageMin: 2, ageMax: 12, minNormal: 50, maxNormal: 80, minCritical: 40, maxCritical: 90 },
        { itemId: rrId, ageMin: 2, ageMax: 12, minNormal: 18, maxNormal: 30, minCritical: 12, maxCritical: 40 },
        { itemId: spo2Id, ageMin: 2, ageMax: 12, minNormal: 95, maxNormal: 100, minCritical: 91, maxCritical: null },
        { itemId: tempId, ageMin: 2, ageMax: 12, minNormal: 36.3, maxNormal: 37.5, minCritical: 35.0, maxCritical: 38.8 },

        // NGƯỜI LỚN (13 - 64 tuổi)
        { itemId: hrId, ageMin: 13, ageMax: 64, minNormal: 60, maxNormal: 90, minCritical: 50, maxCritical: 111 },
        { itemId: sbpId, ageMin: 13, ageMax: 64, minNormal: 90, maxNormal: 119, minCritical: 89, maxCritical: 180 },
        { itemId: dbpId, ageMin: 13, ageMax: 64, minNormal: 60, maxNormal: 79, minCritical: 59, maxCritical: 120 },
        { itemId: rrId, ageMin: 13, ageMax: 64, minNormal: 12, maxNormal: 20, minCritical: 8, maxCritical: 25 },
        { itemId: spo2Id, ageMin: 13, ageMax: 64, minNormal: 96, maxNormal: 100, minCritical: 91, maxCritical: null },
        { itemId: tempId, ageMin: 13, ageMax: 64, minNormal: 36.1, maxNormal: 37.4, minCritical: 35.0, maxCritical: 38.6 },

        // NGƯỜI CAO TUỔI (>= 65 tuổi)
        { itemId: hrId, ageMin: 65, ageMax: 150, minNormal: 55, maxNormal: 90, minCritical: 45, maxCritical: 105 },
        { itemId: sbpId, ageMin: 65, ageMax: 150, minNormal: 100, maxNormal: 130, minCritical: 89, maxCritical: 160 },
        { itemId: dbpId, ageMin: 65, ageMax: 150, minNormal: 60, maxNormal: 80, minCritical: 49, maxCritical: 100 },
        { itemId: rrId, ageMin: 65, ageMax: 150, minNormal: 12, maxNormal: 22, minCritical: 10, maxCritical: 28 },
        { itemId: spo2Id, ageMin: 65, ageMax: 150, minNormal: 94, maxNormal: 98, minCritical: 90, maxCritical: null },
        { itemId: tempId, ageMin: 65, ageMax: 150, minNormal: 36.0, maxNormal: 37.2, minCritical: 35.0, maxCritical: 38.0 },
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
                minCritical: t.minCritical,
                maxCritical: t.maxCritical,
                effectiveFrom,
                isActive: true,
            },
        });
    }

    const count = await prisma.vitalSignThreshold.count();
    console.log(`Seeded vital sign thresholds, total in DB: ${count}`);
}