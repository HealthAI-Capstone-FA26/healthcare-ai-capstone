import { Injectable } from '@nestjs/common';
import { LabParameterThreshold } from '@prisma/client';
import {
    LabResultDetector,
    LabResultWithValues,
    LabDetectionResult,
    LabRiskLevel,
} from '../interfaces/lab-result-detector.interface';
import { PrismaService } from 'prisma/prisma.service';

const POSITIVE_TEXT_MARKERS = ['positive', 'dương tính', 'duong tinh', 'reactive'];

/**
 * Phát hiện bất thường theo ngưỡng LabParameterThreshold — cùng cách tiếp cận với
 * RuleBasedDetector của module vital-anomaly (tra theo tuổi + giới tính tại thời điểm
 * có kết quả), nhưng khác ở chỗ: 1 tham số xét nghiệm có THỂ có nhiều dòng threshold
 * (mỗi dòng ứng với 1 riskLevel: normal | low | medium | high | critical), value được
 * đối chiếu để tìm dòng có [rangeMin, rangeMax] chứa nó.
 */
@Injectable()
export class RuleBasedLabDetector implements LabResultDetector {
    readonly source = 'rule' as const;

    constructor(private readonly prisma: PrismaService) { }

    private calculateAge(dateOfBirth: Date, at: Date): number {
        let age = at.getFullYear() - dateOfBirth.getFullYear();
        const monthDiff = at.getMonth() - dateOfBirth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < dateOfBirth.getDate())) {
            age--;
        }
        return age;
    }

    /**
     * Trả về tập các dòng threshold (nhiều riskLevel) áp dụng cho tham số + tuổi + giới tính,
     * thuộc phiên bản (effectiveFrom) mới nhất còn hiệu lực tại thời điểm `at`.
     */
    private async findApplicableThresholdRows(
        parameterId: string,
        age: number | null,
        gender: string | null,
        at: Date,
    ): Promise<LabParameterThreshold[]> {
        const candidates = await this.prisma.labParameterThreshold.findMany({
            where: {
                parameterId,
                isActive: true,
                effectiveFrom: { lte: at },
                AND: [
                    { OR: [{ ageMin: null }, ...(age !== null ? [{ ageMin: { lte: age } }] : [])] },
                    { OR: [{ ageMax: null }, ...(age !== null ? [{ ageMax: { gte: age } }] : [])] },
                ],
                OR: [{ gender: null }, ...(gender ? [{ gender }] : [])],
            },
            orderBy: { effectiveFrom: 'desc' },
        });

        if (candidates.length === 0) return [];

        // Ưu tiên bản ghi khớp giới tính cụ thể hơn bản ghi dùng chung (gender = null).
        const preferGendered = gender ? candidates.filter((c) => c.gender === gender) : [];
        const pool = preferGendered.length > 0 ? preferGendered : candidates.filter((c) => !c.gender);
        const effectivePool = pool.length > 0 ? pool : candidates;

        const latestEffectiveFrom = effectivePool[0].effectiveFrom;
        return effectivePool.filter(
            (c) => c.effectiveFrom.getTime() === latestEffectiveFrom.getTime(),
        );
    }

    private evaluateNumeric(
        value: number,
        rows: LabParameterThreshold[],
    ): { isAbnormal: boolean; riskLevel: LabRiskLevel | null; matchedRow: LabParameterThreshold | null } {
        const matchedRow = rows.find((r) => {
            const min = r.rangeMin !== null ? Number(r.rangeMin) : -Infinity;
            const max = r.rangeMax !== null ? Number(r.rangeMax) : Infinity;
            return value >= min && value <= max;
        });

        if (!matchedRow) {
            return { isAbnormal: false, riskLevel: null, matchedRow: null };
        }

        const isAbnormal = matchedRow.riskLevel !== 'normal';
        return {
            isAbnormal,
            riskLevel: isAbnormal ? (matchedRow.riskLevel as LabRiskLevel) : null,
            matchedRow,
        };
    }

    private buildReason(params: {
        parameterName: string;
        unit: string | null;
        value: number | string;
        isAbnormal: boolean;
        riskLevel: LabRiskLevel | null;
        row: LabParameterThreshold | null;
    }): string {
        const { parameterName, unit, value, isAbnormal, riskLevel, row } = params;
        const unitStr = unit ? ` ${unit}` : '';
        if (!isAbnormal) {
            return `${parameterName} đo được ${value}${unitStr}, trong khoảng an toàn.`;
        }
        const rangeStr = row
            ? ` (khoảng tham chiếu: ${row.rangeMin ?? '−∞'}–${row.rangeMax ?? '+∞'}${unitStr})`
            : '';
        return `${parameterName} đo được ${value}${unitStr}, mức độ nguy cơ: ${riskLevel}${rangeStr}.`;
    }

    async detect(labResult: LabResultWithValues): Promise<LabDetectionResult[]> {
        const { dateOfBirth, gender } = labResult.patientContext;
        const at = labResult.resultedAt ?? new Date();
        const age = dateOfBirth ? this.calculateAge(dateOfBirth, at) : null;

        const results: LabDetectionResult[] = [];

        for (const value of labResult.values) {
            const dataType = value.parameter.dataType ?? 'numeric';

            if (dataType === 'numeric') {
                if (value.valueNumeric === null || value.valueNumeric === undefined) {
                    continue;
                }
                const numericValue = Number(value.valueNumeric);
                const rows = await this.findApplicableThresholdRows(value.parameterId, age, gender, at);

                if (rows.length === 0) {
                    results.push({
                        resultValueId: value.resultValueId,
                        parameterId: value.parameterId,
                        isAbnormal: false,
                        riskLevel: null,
                        alertSource: 'rule',
                        thresholdId: null,
                        expectedMin: null,
                        expectedMax: null,
                        reason: 'Chưa cấu hình ngưỡng tham chiếu áp dụng cho chỉ số này ở nhóm tuổi/giới tính của bệnh nhân.',
                    });
                    continue;
                }

                const { isAbnormal, riskLevel, matchedRow } = this.evaluateNumeric(numericValue, rows);
                const normalRow = rows.find((r) => r.riskLevel === 'normal') ?? null;

                results.push({
                    resultValueId: value.resultValueId,
                    parameterId: value.parameterId,
                    isAbnormal,
                    riskLevel,
                    alertSource: 'rule',
                    thresholdId: matchedRow?.labThresholdId ?? null,
                    expectedMin: normalRow?.rangeMin !== null && normalRow?.rangeMin !== undefined ? Number(normalRow.rangeMin) : null,
                    expectedMax: normalRow?.rangeMax !== null && normalRow?.rangeMax !== undefined ? Number(normalRow.rangeMax) : null,
                    reason: this.buildReason({
                        parameterName: value.parameter.parameterName ?? value.parameter.parameterCode,
                        unit: value.parameter.unit,
                        value: numericValue,
                        isAbnormal,
                        riskLevel,
                        row: matchedRow,
                    }),
                });
                continue;
            }

            if (dataType === 'positive_negative') {
                // Heuristic đơn giản — TODO: cấu hình rõ ràng theo từng parameter thay vì hardcode từ khoá,
                // vì có xét nghiệm mà kết quả mong đợi là "positive" lại là bình thường (VD: xét nghiệm miễn dịch sau tiêm).
                const text = (value.valueText ?? '').trim().toLowerCase();
                const isAbnormal = POSITIVE_TEXT_MARKERS.some((marker) => text.includes(marker));
                results.push({
                    resultValueId: value.resultValueId,
                    parameterId: value.parameterId,
                    isAbnormal,
                    riskLevel: isAbnormal ? 'high' : null,
                    alertSource: 'rule',
                    thresholdId: null,
                    expectedMin: null,
                    expectedMax: null,
                    reason: isAbnormal
                        ? `${value.parameter.parameterName ?? value.parameter.parameterCode} cho kết quả dương tính — cần bác sĩ xem xét.`
                        : undefined,
                });
                continue;
            }

            // dataType === 'text' hoặc khác: không tự động đánh giá, để bác sĩ đọc kết quả trực tiếp.
        }

        return results;
    }
}
