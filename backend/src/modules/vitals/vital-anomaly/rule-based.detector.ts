import { VitalSignThreshold } from '@prisma/client';
import {
    VitalSignDetector,
    VitalSignSessionWithObservations,
    DetectionResult,
    AlertLevel,
} from './vital-sign-detector.interface';
import { PrismaService } from '../../../../prisma/prisma.service';
import { calculateAge, findApplicableThreshold } from '../common/vital-threshold.utils';

// Rule-based detection (phát hiện dị thường sinh hiệu trên các tài liệu y tế hiện có)
export class RuleBasedDetector implements VitalSignDetector {
    readonly source = 'rule' as const;

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Mô hình đơn giản: CHỈ so với [minNormal, maxNormal]. Value ngoài khoảng này = bất thường,
     * và mọi bất thường đều là 'critical' (không còn phân biệt warning/critical như trước).
     */
    private evaluate(
        value: number,
        threshold: VitalSignThreshold,
    ): { isAbnormal: boolean; level: AlertLevel | null } {
        const minNormal = Number(threshold.minNormal);
        const maxNormal = Number(threshold.maxNormal);

        const isAbnormal = value < minNormal || value > maxNormal;
        return isAbnormal ? { isAbnormal: true, level: 'critical' } : { isAbnormal: false, level: null };
    }

    /**
     * Dựng câu diễn giải có trích dẫn nguồn cho 1 kết quả đánh giá.
     * VD: "SBP đo được 130 mmHg, ngoài khoảng bình thường 90–119 mmHg
     *      (nhóm tuổi 13–64). Nguồn: AHA/ACC 2017 Hypertension Guideline"
     */
    private buildReason(params: {
        itemName: string;
        unit: string;
        value: number;
        threshold: VitalSignThreshold;
        isAbnormal: boolean;
        age: number;
    }): string {
        const { itemName, unit, value, threshold, isAbnormal, age } = params;
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

        return `${itemName} đo được ${value} ${unit}, ngoài khoảng bình thường ${minNormal}–${maxNormal} ${unit} (${ageRange}) - bất thường.${source}`;
    }

    async detect(session: VitalSignSessionWithObservations): Promise<DetectionResult[]> {
        const dateOfBirth = session.patient.dateOfBirth;
        const gender = session.patient.gender ?? null;

        if (!dateOfBirth) {
            throw new Error('Bệnh nhân chưa có ngày sinh, không thể xác định ngưỡng theo độ tuổi');
        }

        const age = calculateAge(dateOfBirth, session.measuredAt);
        const results: DetectionResult[] = [];

        for (const obs of session.observations) {
            const threshold = await findApplicableThreshold(this.prisma, obs.itemId, age, gender, session.measuredAt);

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