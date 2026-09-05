import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { LabResultDetector, LabDetectionResult, LabRiskLevel, LabResultWithValues } from './lab-result-detector.interface';
import { RuleBasedLabDetector } from './rule-based.detector';
import { AiLabResultDetector } from './ai-lab-result.detector';
import { LabPatientContextResolver } from './lab-patient-context.resolver';

const RISK_SEVERITY: Record<LabRiskLevel, number> = { low: 1, medium: 2, high: 3, critical: 4 };

/**
 * Chạy tất cả detector đã đăng ký (rule-based, ai-based, ...) cho 1 LabResult, gộp kết quả
 * theo resultValueId (nếu nhiều detector cùng báo 1 giá trị thì lấy mức độ nặng nhất), rồi
 * ghi isAbnormal + tạo LabResultAlert. Kiến trúc mirror 1:1 VitalSignDetectionOrchestrator
 * của module vital-anomaly.
 */
@Injectable()
export class LabResultDetectionOrchestrator {
    private readonly detectors: LabResultDetector[];

    constructor(
        private readonly prisma: PrismaService,
        private readonly patientContextResolver: LabPatientContextResolver,
        ruleBasedDetector?: RuleBasedLabDetector,
        aiDetector?: AiLabResultDetector,
    ) {
        this.detectors = [ruleBasedDetector ?? new RuleBasedLabDetector(prisma), aiDetector ?? new AiLabResultDetector()];
    }

    async run(labResultId: string): Promise<LabDetectionResult[]> {
        const labResult = await this.prisma.labResult.findUniqueOrThrow({
            where: { labResultId },
            include: { values: { include: { parameter: true } } },
        });

        const patientContext = await this.patientContextResolver.resolve(labResultId);
        const resultForDetectors: LabResultWithValues = { ...labResult, patientContext };

        const allResults = (await Promise.all(this.detectors.map((d) => d.detect(resultForDetectors)))).flat();

        // Gộp theo resultValueId: giữ lại kết quả có mức độ nguy cơ nặng nhất.
        const merged = new Map<string, LabDetectionResult>();
        for (const result of allResults) {
            const existing = merged.get(result.resultValueId);
            if (!existing) {
                merged.set(result.resultValueId, result);
                continue;
            }
            const existingSeverity = existing.riskLevel ? RISK_SEVERITY[existing.riskLevel] : 0;
            const newSeverity = result.riskLevel ? RISK_SEVERITY[result.riskLevel] : 0;
            if (newSeverity > existingSeverity) {
                merged.set(result.resultValueId, result);
            }
        }

        const finalResults = Array.from(merged.values());

        for (const result of finalResults) {
            await this.prisma.labResultValue.update({
                where: { resultValueId: result.resultValueId },
                data: { isAbnormal: result.isAbnormal },
            });

            if (result.isAbnormal && result.riskLevel) {
                const existingActiveAlert = await this.prisma.labResultAlert.findFirst({
                    where: { resultValueId: result.resultValueId, status: 'active' },
                });

                if (!existingActiveAlert) {
                    const value = labResult.values.find((v) => v.resultValueId === result.resultValueId)!;
                    const measuredValue =
                        value.valueNumeric !== null && value.valueNumeric !== undefined
                            ? value.valueNumeric.toString()
                            : (value.valueText ?? '');

                    await this.prisma.labResultAlert.create({
                        data: {
                            resultValueId: result.resultValueId,
                            encounterId: patientContext.encounterId,
                            thresholdId: result.thresholdId,
                            measuredValue,
                            riskLevel: result.riskLevel,
                            expectedMin: result.expectedMin,
                            expectedMax: result.expectedMax,
                            status: 'active',
                        },
                    });
                }
            }
        }

        return finalResults;
    }
}
