import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { LabDetectionResult, LabResultWithValues } from '../interfaces/lab-result-detector.interface';
import { RuleBasedLabDetector } from '../detectors/rule-based.detector';
import { LabPatientContextResolver } from '../resolvers/lab-patient-context.resolver';

/** Mức nguy cơ phải gửi thông báo ngay cho bác sĩ (critical_value_alert). */
export const NOTIFY_RISK_LEVELS = ['critical'];

export interface CreatedLabAlert {
    alertId: string;
    resultValueId: string;
    parameterName: string;
    riskLevel: string;
}

export interface LabDetectionRunOutput {
    results: LabDetectionResult[];
    /** Alert MỚI tạo ở lần chạy này (không gồm alert đã có) — dùng để quyết định gửi thông báo. */
    newAlerts: CreatedLabAlert[];
    encounterId: string;
    doctorUserId: string | null;
}

/**
 * Chạy detector rồi ĐỒNG BỘ kết quả vào DB trong 1 transaction (idempotent, chạy lại được sau khi đính chính):
 *   - cập nhật ResultValue.isAbnormal;
 *   - bất thường: chưa có alert (active|confirmed) cho value -> tạo ResultValueAlert 'active'; đã có -> cập nhật
 *     riskLevel/ngưỡng nếu thay đổi (giữ nguyên status);
 *   - không còn bất thường (vd. sau đính chính): các alert active|confirmed của value -> 'resolved'.
 * ResultValueAlert không còn lưu measuredValue/alertSource (schema mới) — giá trị đo lấy từ ResultValue.
 */
@Injectable()
export class LabResultDetectionOrchestrator {
    constructor(
        private readonly prisma: PrismaService,
        private readonly ruleBasedDetector: RuleBasedLabDetector,
        private readonly patientContextResolver: LabPatientContextResolver,
    ) {}

    async run(resultId: string): Promise<LabDetectionRunOutput> {
        const result = await this.prisma.diagnosticResult.findUniqueOrThrow({
            where: { resultId },
            include: { values: { include: { parameter: true } } },
        });
        const patientContext = await this.patientContextResolver.resolve(resultId);
        const withContext: LabResultWithValues = { ...result, patientContext };

        const results = await this.ruleBasedDetector.detect(withContext);
        const nameById = new Map(result.values.map((v) => [v.resultValueId, v.parameter.parameterName ?? v.parameter.parameterCode]));
        const newAlerts: CreatedLabAlert[] = [];

        await this.prisma.$transaction(async (tx) => {
            for (const r of results) {
                await tx.resultValue.update({ where: { resultValueId: r.resultValueId }, data: { isAbnormal: r.isAbnormal } });

                const openAlerts = await tx.resultValueAlert.findMany({
                    where: { resultValueId: r.resultValueId, status: { in: ['active', 'confirmed'] } },
                    orderBy: { createdAt: 'desc' },
                });

                if (r.isAbnormal && r.riskLevel) {
                    const data = { riskLevel: r.riskLevel, thresholdId: r.thresholdId, expectedMin: r.expectedMin, expectedMax: r.expectedMax };
                    const existing = openAlerts[0];
                    if (existing) {
                        if (existing.riskLevel !== r.riskLevel) {
                            await tx.resultValueAlert.update({ where: { alertId: existing.alertId }, data });
                        }
                        // chỉ giữ 1 alert mở cho mỗi value
                        const extras = openAlerts.slice(1).map((a) => a.alertId);
                        if (extras.length > 0) {
                            await tx.resultValueAlert.updateMany({ where: { alertId: { in: extras } }, data: { status: 'resolved' } });
                        }
                    } else {
                        const created = await tx.resultValueAlert.create({
                            data: { resultValueId: r.resultValueId, encounterId: patientContext.encounterId, status: 'active', ...data },
                        });
                        newAlerts.push({
                            alertId: created.alertId,
                            resultValueId: r.resultValueId,
                            parameterName: nameById.get(r.resultValueId) ?? '',
                            riskLevel: r.riskLevel,
                        });
                    }
                } else if (openAlerts.length > 0) {
                    await tx.resultValueAlert.updateMany({
                        where: { alertId: { in: openAlerts.map((a) => a.alertId) } },
                        data: { status: 'resolved' },
                    });
                }
            }
        });

        return { results, newAlerts, encounterId: patientContext.encounterId, doctorUserId: patientContext.doctorUserId };
    }
}
