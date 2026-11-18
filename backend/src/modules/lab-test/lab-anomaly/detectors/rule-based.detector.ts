import { Injectable } from '@nestjs/common';
import { ResultParameterThreshold } from '@prisma/client';
import {
    LabDetectionResult,
    LabResultDetector,
    LabResultWithValues,
    LabRiskLevel,
} from '../interfaces/lab-result-detector.interface';
import { ResultThresholdResolver } from '../../lab-reference-range/result-threshold.resolver';

/**
 * Phát hiện bất thường theo ResultParameterThreshold (tra theo tuổi + giới tính tại thời điểm có kết quả). Một tham số
 * có thể có nhiều dòng ngưỡng (mỗi dòng 1 riskLevel: normal | low | medium | high | critical); giá trị được đối chiếu để
 * tìm dòng có [rangeMin, rangeMax] chứa nó.
 *
 * Phạm vi theo dataType:
 *   - numeric : đối chiếu ngưỡng.
 *   - boolean : `true` = bất thường (mức 'high') — quy ước: tham số boolean mô tả "có dấu hiệu bệnh lý"
 *               (vd: "Phình thất trái = true"). Tham số có ý nghĩa ngược lại cần cấu hình riêng.
 *   - text | enum : KHÔNG tự đánh giá — để bác sĩ đọc trực tiếp.
 */
@Injectable()
export class RuleBasedLabDetector implements LabResultDetector {
    constructor(private readonly thresholdResolver: ResultThresholdResolver) {}

    private evaluateNumeric(
        value: number,
        rows: ResultParameterThreshold[],
    ): { isAbnormal: boolean; riskLevel: LabRiskLevel | null; matchedRow: ResultParameterThreshold | null } {
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
        row: ResultParameterThreshold | null;
    }): string {
        const { parameterName, unit, value, isAbnormal, riskLevel, row } = params;
        const unitStr = unit ? ` ${unit}` : '';
        if (!isAbnormal) {
            return `${parameterName} đo được ${value}${unitStr}, trong khoảng an toàn.`;
        }
        const rangeStr = row ? ` (khoảng tham chiếu: ${row.rangeMin ?? '−∞'}–${row.rangeMax ?? '+∞'}${unitStr})` : '';
        return `${parameterName} đo được ${value}${unitStr}, mức độ nguy cơ: ${riskLevel}${rangeStr}.`;
    }

    async detect(labResult: LabResultWithValues): Promise<LabDetectionResult[]> {
        const { dateOfBirth, gender } = labResult.patientContext;
        const at = labResult.resultedAt ?? new Date();
        const age = dateOfBirth ? this.thresholdResolver.calculateAge(dateOfBirth, at) : null;

        const results: LabDetectionResult[] = [];

        for (const value of labResult.values) {
            const parameterName = value.parameter.parameterName ?? value.parameter.parameterCode;

            if (value.parameter.dataType === 'numeric') {
                if (value.valueNumeric === null || value.valueNumeric === undefined) continue;

                const numericValue = Number(value.valueNumeric);
                const rows = await this.thresholdResolver.findApplicableRows(value.parameterId, age, gender, at);

                if (rows.length === 0) {
                    results.push({
                        resultValueId: value.resultValueId,
                        parameterId: value.parameterId,
                        isAbnormal: false,
                        riskLevel: null,
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
                    thresholdId: matchedRow?.thresholdId ?? null,
                    expectedMin: normalRow?.rangeMin != null ? Number(normalRow.rangeMin) : null,
                    expectedMax: normalRow?.rangeMax != null ? Number(normalRow.rangeMax) : null,
                    reason: this.buildReason({
                        parameterName,
                        unit: value.parameter.unit,
                        value: numericValue,
                        isAbnormal,
                        riskLevel,
                        row: matchedRow,
                    }),
                });
                continue;
            }

            if (value.parameter.dataType === 'boolean') {
                if (value.valueBoolean === null || value.valueBoolean === undefined) continue;

                const isAbnormal = value.valueBoolean === true;
                results.push({
                    resultValueId: value.resultValueId,
                    parameterId: value.parameterId,
                    isAbnormal,
                    riskLevel: isAbnormal ? 'high' : null,
                    thresholdId: null,
                    expectedMin: null,
                    expectedMax: null,
                    reason: isAbnormal ? `${parameterName} ghi nhận dấu hiệu bất thường — cần bác sĩ xem xét.` : undefined,
                });
            }
            // text | enum: không tự đánh giá.
        }

        return results;
    }
}
