import { VitalSignDetector, DetectionResult } from './vital-sign-detector.interface';
import { RuleBasedDetector } from './rule-based.detector';
import { AiVitalSignDetector } from './ai-vital-sign.detector';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Chạy tất cả detector đã đăng ký (rule-based, ai-based, ...) cho 1 session,
 * gộp kết quả theo observationId (nếu nhiều detector cùng báo 1 observation
 * thì ưu tiên kết quả isAbnormal=true — chỉ còn 1 mức 'critical' nên không cần
 * so sánh độ nặng như trước), rồi ghi isAbnormal + tạo VitalSignAlert.
 */
export class VitalSignDetectionOrchestrator {
    private readonly detectors: VitalSignDetector[];

    constructor(private readonly prisma: PrismaService, detectors?: VitalSignDetector[]) {
        this.detectors = detectors ?? [new RuleBasedDetector(prisma), new AiVitalSignDetector()];
    }

    async run(vitalSessionId: string): Promise<DetectionResult[]> {
        const session = await this.prisma.vitalSignSession.findUniqueOrThrow({
            where: { vitalSessionId },
            include: {
                observations: { include: { item: true } },
                patient: true,
            },
        });

        const sessionForDetectors = session as Parameters<VitalSignDetector['detect']>[0];

        const allResults = (
            await Promise.all(this.detectors.map((d) => d.detect(sessionForDetectors)))
        ).flat();

        // Gộp theo observationId: nếu bất kỳ detector nào báo isAbnormal=true, ưu tiên giữ
        const merged = new Map<string, DetectionResult>();
        for (const result of allResults) {
            const existing = merged.get(result.observationId);
            if (!existing || (result.isAbnormal && !existing.isAbnormal)) {
                merged.set(result.observationId, result);
            }
        }

        const finalResults = Array.from(merged.values());

        for (const result of finalResults) {
            await this.prisma.vitalSignObservation.update({
                where: { observationId: result.observationId },
                data: { isAbnormal: result.isAbnormal },
            });

            if (result.isAbnormal && result.alertLevel) {
                const existingActiveAlert = await this.prisma.vitalSignAlert.findFirst({
                    where: { observationId: result.observationId, status: 'active' },
                });

                if (!existingActiveAlert) {
                    const observation = session.observations.find(
                        (o) => o.observationId === result.observationId,
                    )!;

                    await this.prisma.vitalSignAlert.create({
                        data: {
                            observationId: result.observationId,
                            encounterId: session.encounterId,
                            vitalThresholdId: result.thresholdId,
                            alertLevel: result.alertLevel,
                            alertSource: result.alertSource,
                            measuredValue: observation.observationValue,
                            expectedMin: result.expectedMin,
                            expectedMax: result.expectedMax,
                            status: 'active',
                            reason: result.reason,
                        },
                    });
                }
            }
        }

        return finalResults;
    }
}