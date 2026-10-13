import { VitalSignThreshold } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Logic dùng chung cho mọi nơi cần đọc VitalSignThreshold (rule-based detector,
 * reference-range service cho UI, ...), tránh viết lặp lại ở nhiều nơi rồi lệch nhau.
 *
 * Mô hình threshold: CHỈ có minNormal/maxNormal. Không có minCritical/maxCritical/
 * minWarning/maxWarning riêng — "anomaly" (bất thường) được suy ra thẳng từ việc
 * value có nằm ngoài [minNormal, maxNormal] hay không, và mọi anomaly đều là 'critical'.
 */

export function calculateAge(dateOfBirth: Date, measuredAt: Date): number {
    let age = measuredAt.getFullYear() - dateOfBirth.getFullYear();
    const monthDiff = measuredAt.getMonth() - dateOfBirth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && measuredAt.getDate() < dateOfBirth.getDate())) {
        age--;
    }
    return age;
}

export async function findApplicableThreshold(
    prisma: PrismaService,
    itemId: string,
    age: number,
    gender: string | null,
    measuredAt: Date,
): Promise<VitalSignThreshold | null> {
    const thresholds = await prisma.vitalSignThreshold.findMany({
        where: {
            itemId,
            isActive: true,
            effectiveFrom: { lte: measuredAt },
            AND: [
                { OR: [{ ageMin: null }, { ageMin: { lte: age } }] },
                { OR: [{ ageMax: null }, { ageMax: { gte: age } }] },
            ],
        },
        orderBy: { effectiveFrom: 'desc' },
    });

    if (thresholds.length === 0) return null;

    const genderMatch = gender ? thresholds.find((t) => t.gender === gender) : undefined;
    return genderMatch ?? thresholds.find((t) => !t.gender) ?? thresholds[0];
}
