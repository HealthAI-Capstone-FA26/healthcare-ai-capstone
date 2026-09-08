import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { LabPatientContext } from '../interfaces/lab-result-detector.interface';

/**
 * Tra cứu ngữ cảnh bệnh nhân (ngày sinh, giới tính, encounterId) từ 1 LabResult — cần để
 * tính tuổi khi tra ngưỡng (LabParameterThreshold) và biết push cảnh báo realtime vào room nào.
 *
 * Đường quan hệ thật (theo schema.prisma của hệ thống):
 *   LabResult -> LabTask -> TestOrderItem (orderItem) -> TestOrder (order) -> Encounter -> Patient
 */
@Injectable()
export class LabPatientContextResolver {
    constructor(private readonly prisma: PrismaService) { }

    async resolve(labResultId: string): Promise<LabPatientContext> {
        const labResult = await this.prisma.labResult.findUniqueOrThrow({
            where: { labResultId },
            include: {
                labTask: {
                    include: {
                        orderItem: {
                            include: {
                                order: {
                                    include: {
                                        encounter: { include: { patient: true } },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        const { encounter } = labResult.labTask.orderItem.order;

        return {
            dateOfBirth: encounter.patient.dateOfBirth,
            gender: encounter.patient.gender,
            encounterId: encounter.encounterId,
        };
    }
}
