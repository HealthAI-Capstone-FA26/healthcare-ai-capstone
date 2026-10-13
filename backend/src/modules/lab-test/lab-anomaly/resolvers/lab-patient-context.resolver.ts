import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { LabPatientContext } from '../interfaces/lab-result-detector.interface';

/**
 * Tra ngữ cảnh bệnh nhân từ 1 DiagnosticResult. Đường quan hệ:
 *   DiagnosticResult -> DiagnosticTask -> DiagnosticOrderItem -> DiagnosticOrder -> Encounter -> Patient
 * và bác sĩ chỉ định: DiagnosticOrder.doctor.userId.
 */
@Injectable()
export class LabPatientContextResolver {
    constructor(private readonly prisma: PrismaService) {}

    async resolve(resultId: string): Promise<LabPatientContext> {
        const result = await this.prisma.diagnosticResult.findUniqueOrThrow({
            where: { resultId },
            include: {
                task: {
                    include: {
                        orderItem: {
                            include: {
                                order: {
                                    include: {
                                        doctor: { select: { userId: true } },
                                        encounter: { include: { patient: true } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        const { order } = result.task.orderItem;
        const { encounter } = order;

        return {
            dateOfBirth: encounter.patient.dateOfBirth,
            gender: encounter.patient.gender,
            encounterId: encounter.encounterId,
            patientId: encounter.patientId,
            doctorUserId: order.doctor?.userId ?? null,
        };
    }
}
