import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { DrugInteractionDetector } from '../detectors/drug-interaction.detector';
import { DuplicateTherapeuticClassDetector } from '../detectors/duplicate-therapeutic-class.detector';
import { AllergyContraindicationDetector } from '../detectors/allergy-contraindication.detector';
import { PrescriptionSafetyDetector, PrescriptionSafetyDetectionResult } from '../interfaces/prescription-safety-detector.interface';

/**
 * Chạy đồng bộ 3 detector Safety Check ngay trong request (theo quyết định 2-A của plan
 * module 9 — không dùng event/listener/gateway bất đồng bộ như lab-anomaly/vital-anomaly).
 * Được PrescriptionService gọi ngay sau khi commit transaction ghi PrescriptionItem.
 */
@Injectable()
export class PrescriptionSafetyCheckOrchestrator {
    private readonly detectors: PrescriptionSafetyDetector[];

    constructor(
        private readonly prisma: PrismaService,
        drugInteractionDetector: DrugInteractionDetector,
        duplicateTherapeuticClassDetector: DuplicateTherapeuticClassDetector,
        allergyContraindicationDetector: AllergyContraindicationDetector,
    ) {
        this.detectors = [drugInteractionDetector, duplicateTherapeuticClassDetector, allergyContraindicationDetector];
    }

    async run(prescriptionId: string): Promise<PrescriptionSafetyDetectionResult[]> {
        const prescription = await this.prisma.prescription.findUnique({
            where: { prescriptionId },
            include: {
                items: { include: { drug: true } },
                encounter: { select: { patientId: true } },
            },
        });

        if (!prescription) {
            throw new NotFoundException('Không tìm thấy đơn thuốc');
        }

        const { items, encounter } = prescription;
        const patientId = encounter.patientId;

        const allResults = (
            await Promise.all(this.detectors.map((detector) => detector.detect(prescriptionId, items, patientId)))
        ).flat();

        await this.prisma.$transaction(async (tx) => {
            await tx.prescriptionSafetyAlert.deleteMany({ where: { prescriptionId, status: 'active' } });

            if (allResults.length > 0) {
                await tx.prescriptionSafetyAlert.createMany({
                    data: allResults.map(
                        (result): Prisma.PrescriptionSafetyAlertCreateManyInput => ({
                            prescriptionId,
                            alertType: result.alertType,
                            relatedItemIdA: result.relatedItemIdA,
                            relatedItemIdB: result.relatedItemIdB,
                            severity: result.severity,
                            description: result.description,
                            status: 'active',
                        }),
                    ),
                });
            }
        });

        return allResults;
    }
}
