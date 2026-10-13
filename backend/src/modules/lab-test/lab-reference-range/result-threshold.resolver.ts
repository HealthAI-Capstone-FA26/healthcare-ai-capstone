import { Injectable } from '@nestjs/common';
import { ResultParameterThreshold } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Tra ngưỡng áp dụng cho 1 ResultParameter theo tuổi + giới tính + thời điểm. Nguồn DUY NHẤT cho cả
 * LabReferenceRangeService (hiển thị ngưỡng cạnh ô nhập) và RuleBasedLabDetector (phát hiện bất thường),
 * để hai nơi không bao giờ lệch nhau.
 *
 * Ưu tiên: dòng đúng giới tính > dòng không phân biệt giới tính; trong cùng nhóm lấy effectiveFrom mới nhất.
 */
@Injectable()
export class ResultThresholdResolver {
    constructor(private readonly prisma: PrismaService) {}

    calculateAge(dateOfBirth: Date, at: Date): number {
        let age = at.getFullYear() - dateOfBirth.getFullYear();
        const monthDiff = at.getMonth() - dateOfBirth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < dateOfBirth.getDate())) {
            age--;
        }
        return age;
    }

    async findApplicableRows(
        parameterId: string,
        age: number | null,
        gender: string | null,
        at: Date,
    ): Promise<ResultParameterThreshold[]> {
        const candidates = await this.prisma.resultParameterThreshold.findMany({
            where: {
                parameterId,
                isActive: true,
                effectiveFrom: { lte: at },
                ...(age !== null
                    ? {
                          AND: [
                              { OR: [{ ageMin: null }, { ageMin: { lte: age } }] },
                              { OR: [{ ageMax: null }, { ageMax: { gte: age } }] },
                          ],
                      }
                    : {}),
                OR: [{ gender: null }, ...(gender ? [{ gender }] : [])],
            },
            orderBy: { effectiveFrom: 'desc' },
        });

        if (candidates.length === 0) return [];

        const preferGendered = gender ? candidates.filter((c) => c.gender === gender) : [];
        const pool = preferGendered.length > 0 ? preferGendered : candidates.filter((c) => !c.gender);
        const effectivePool = pool.length > 0 ? pool : candidates;

        const latestEffectiveFrom = effectivePool[0].effectiveFrom;
        return effectivePool.filter((c) => c.effectiveFrom.getTime() === latestEffectiveFrom.getTime());
    }
}
