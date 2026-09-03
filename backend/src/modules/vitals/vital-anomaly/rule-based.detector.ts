import { VitalSignThreshold } from '@prisma/client';
import {
    VitalSignDetector,
    VitalSignSessionWithObservations,
    DetectionResult,
    AlertLevel,
} from './vital-sign-detector.interface';
import { PrismaService } from '../../../../prisma/prisma.service';

// Rule-based detection (phát hiện dị thường sinh hiệu trên các tài liệu y tế hiện có)
export class RuleBasedDetector implements VitalSignDetector {
    readonly source = 'rule' as const;

    constructor(private readonly prisma: PrismaService) { }

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

    private evaluate(
        value: number,
        threshold: VitalSignThreshold,
    ): { isAbnormal: boolean; level: AlertLevel | null } {
        const minCritical = threshold.minCritical !== null ? Number(threshold.minCritical) : null;
        const maxCritical = threshold.maxCritical !== null ? Number(threshold.maxCritical) : null;
        const minNormal = Number(threshold.minNormal);
        const maxNormal = Number(threshold.maxNormal);

        if ((minCritical !== null && value < minCritical) || (maxCritical !== null && value > maxCritical)) {
            return { isAbnormal: true, level: 'critical' };
        }
        if (value < minNormal || value > maxNormal) {
            return { isAbnormal: true, level: 'warning' };
        }
        return { isAbnormal: false, level: null };
    }

    /**
     * Dựng câu diễn giải có trích dẫn nguồn cho 1 kết quả đánh giá.
     * VD: "SBP đo được 130 mmHg, vượt ngưỡng bình thường 90–119 mmHg
     *      (nhóm tuổi 13–64). Nguồn: AHA/ACC 2017 Hypertension Guideline"
     */
    private buildReason(params: {
        itemName: string;
        unit: string;
        value: number;
        threshold: VitalSignThreshold;
        isAbnormal: boolean;
        level: AlertLevel | null;
        age: number;
    }): string {
        const { itemName, unit, value, threshold, isAbnormal, level, age } = params;
        const minNormal = Number(threshold.minNormal);
        const maxNormal = Number(threshold.maxNormal);
        const ageRange =
            threshold.ageMin !== null && threshold.ageMax !== null
                ? `nhóm tuổi ${threshold.ageMin}–${threshold.ageMax}`
                : `tuổi ${age}`;
        const source = threshold.sourceReference ? ` Nguồn: ${threshold.sourceReference}.` : '';

        if (!isAbnormal) {
            return `${itemName} đo được ${value} ${unit}, trong khoảng bình thường ${minNormal}–${maxNormal} ${unit} (${ageRange}).${source}`;
        }

        if (level === 'critical') {
            const minCritical = threshold.minCritical !== null ? Number(threshold.minCritical) : null;
            const maxCritical = threshold.maxCritical !== null ? Number(threshold.maxCritical) : null;
            const criticalDesc =
                minCritical !== null && maxCritical !== null
                    ? `ngưỡng nguy kịch: <${minCritical} hoặc >${maxCritical} ${unit}`
                    : minCritical !== null
                        ? `ngưỡng nguy kịch: <${minCritical} ${unit}`
                        : `ngưỡng nguy kịch: >${maxCritical} ${unit}`;
            return `${itemName} đo được ${value} ${unit}, vượt ${criticalDesc} (${ageRange}).${source}`;
        }

        return `${itemName} đo được ${value} ${unit}, ngoài khoảng bình thường ${minNormal}–${maxNormal} ${unit} (${ageRange}).${source}`;
    }

    async detect(session: VitalSignSessionWithObservations): Promise<DetectionResult[]> {
        const dateOfBirth = session.patient.dateOfBirth;
        const gender = session.patient.gender ?? null;

        if (!dateOfBirth) {
            throw new Error('Bệnh nhân chưa có ngày sinh, không thể xác định ngưỡng theo độ tuổi');
        }

        const age = this.calculateAge(dateOfBirth, session.measuredAt);
        const results: DetectionResult[] = [];

        for (const obs of session.observations) {
            const threshold = await this.findApplicableThreshold(obs.itemId, age, gender, session.measuredAt);

            if (!threshold) {
                results.push({
                    observationId: obs.observationId,
                    itemId: obs.itemId,
                    isAbnormal: false,
                    alertLevel: null,
                    alertSource: 'rule',
                    thresholdId: null,
                    expectedMin: null,
                    expectedMax: null,
                    reason: 'Không tìm thấy ngưỡng tham chiếu áp dụng cho chỉ số này ở nhóm tuổi/giới tính của bệnh nhân.',
                });
                continue;
            }

            const value = Number(obs.observationValue);
            const { isAbnormal, level } = this.evaluate(value, threshold);
            const reason = this.buildReason({
                itemName: obs.item.itemName,
                unit: obs.item.unit,
                value,
                threshold,
                isAbnormal,
                level,
                age,
            });

            results.push({
                observationId: obs.observationId,
                itemId: obs.itemId,
                isAbnormal,
                alertLevel: level,
                alertSource: 'rule',
                thresholdId: threshold.vitalThresholdId,
                expectedMin: Number(threshold.minNormal),
                expectedMax: Number(threshold.maxNormal),
                reason,
            });
        }

        return results;
    }
}