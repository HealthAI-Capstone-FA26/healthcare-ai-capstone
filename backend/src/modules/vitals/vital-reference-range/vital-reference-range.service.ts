import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { VitalSignThreshold } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';

export interface VitalReferenceRangeDto {
    itemCode: string;
    itemName: string;
    unit: string;
    minNormal: number;
    maxNormal: number;
    minCritical: number | null;
    maxCritical: number | null;
    sourceReference: string | null;
}

/**
 * Trả về khoảng bình thường / nguy kịch của từng chỉ số sinh hiệu áp dụng cho 1 bệnh nhân
 * cụ thể (theo tuổi tại thời điểm đo + giới tính). Dùng để giao diện điều dưỡng hiển thị
 * ngay cạnh ô nhập liệu (VD: "HA tâm thu: bình thường 90–119 mmHg") — không cần đợi submit
 * mới biết chỉ số có bất thường hay không.
 *
 * LƯU Ý: hàm tính tuổi + tìm ngưỡng áp dụng bên dưới được viết độc lập, KHÔNG import từ
 * vital-anomaly/rule-based.detector.ts, để không đụng vào module vital-anomaly hiện có.
 * Logic 2 bên đang giống nhau — nếu sau này cần, nên tách thành 1 shared util dùng chung.
 */
@Injectable()
export class VitalReferenceRangeService {
    constructor(private readonly prisma: PrismaService) { }

    async getReferenceRanges(patientId: string, measuredAtInput?: string): Promise<VitalReferenceRangeDto[]> {
        const patient = await this.prisma.patient.findUnique({
            where: { patientId },
            select: { dateOfBirth: true, gender: true },
        });

        if (!patient) {
            throw new NotFoundException(`Không tìm thấy bệnh nhân ${patientId}`);
        }
        if (!patient.dateOfBirth) {
            throw new BadRequestException(
                'Bệnh nhân chưa có ngày sinh, không thể xác định khoảng bình thường theo độ tuổi.',
            );
        }

        const measuredAt = measuredAtInput ? new Date(measuredAtInput) : new Date();
        const age = this.calculateAge(patient.dateOfBirth, measuredAt);

        const items = await this.prisma.vitalSignItem.findMany({ where: { isActive: true } });

        const ranges: VitalReferenceRangeDto[] = [];
        for (const item of items) {
            const threshold = await this.findApplicableThreshold(item.itemId, age, patient.gender, measuredAt);
            if (!threshold) continue; // Chỉ số chưa có ngưỡng cấu hình (VD: HEIGHT, WEIGHT, BMI) — bỏ qua.

            ranges.push({
                itemCode: item.itemCode,
                itemName: item.itemName,
                unit: item.unit,
                minNormal: Number(threshold.minNormal),
                maxNormal: Number(threshold.maxNormal),
                minCritical: threshold.minCritical !== null ? Number(threshold.minCritical) : null,
                maxCritical: threshold.maxCritical !== null ? Number(threshold.maxCritical) : null,
                sourceReference: threshold.sourceReference,
            });
        }

        return ranges;
    }

    private calculateAge(dateOfBirth: Date, measuredAt: Date): number {
        let age = measuredAt.getFullYear() - dateOfBirth.getFullYear();
        const monthDiff = measuredAt.getMonth() - dateOfBirth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && measuredAt.getDate() < dateOfBirth.getDate())) {
            age--;
        }
        return age;
    }

    private async findApplicableThreshold(
        itemId: string,
        age: number,
        gender: string | null,
        measuredAt: Date,
    ): Promise<VitalSignThreshold | null> {
        const thresholds = await this.prisma.vitalSignThreshold.findMany({
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
}
