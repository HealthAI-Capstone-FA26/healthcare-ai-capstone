import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import {
    PrescriptionItemWithDrug,
    PrescriptionSafetyDetectionResult,
    PrescriptionSafetyDetector,
} from '../interfaces/prescription-safety-detector.interface';

/**
 * Với mọi cặp thuốc trong đơn, tra bảng DrugInteraction (2 chiều drugIdA/drugIdB,
 * isActive=true), sinh 1 alert cho mỗi cặp có tương tác được ghi nhận.
 */
@Injectable()
export class DrugInteractionDetector implements PrescriptionSafetyDetector {
    constructor(private readonly prisma: PrismaService) {}

    async detect(
        _prescriptionId: string,
        items: PrescriptionItemWithDrug[],
        _patientId: string,
    ): Promise<PrescriptionSafetyDetectionResult[]> {
        const drugIds = [...new Set(items.map((item) => item.drugId))];
        if (drugIds.length < 2) return [];

        const interactions = await this.prisma.drugInteraction.findMany({
            where: {
                isActive: true,
                drugIdA: { in: drugIds },
                drugIdB: { in: drugIds },
            },
            include: { drugA: true, drugB: true },
        });

        if (interactions.length === 0) return [];

        const results: PrescriptionSafetyDetectionResult[] = [];

        // Có thể nhiều PrescriptionItem cùng trỏ tới 1 drugId (hiếm nhưng không cấm ở DTO) —
        // duyệt theo item thật trong đơn để relatedItemIdA/B luôn trỏ đúng dòng thuốc cụ thể.
        for (const interaction of interactions) {
            const itemsA = items.filter((item) => item.drugId === interaction.drugIdA);
            const itemsB = items.filter((item) => item.drugId === interaction.drugIdB);

            for (const itemA of itemsA) {
                for (const itemB of itemsB) {
                    if (itemA.prescriptionItemId === itemB.prescriptionItemId) continue;

                    results.push({
                        alertType: 'drug_interaction',
                        relatedItemIdA: itemA.prescriptionItemId,
                        relatedItemIdB: itemB.prescriptionItemId,
                        severity: interaction.severity as PrescriptionSafetyDetectionResult['severity'],
                        description: `Tương tác thuốc giữa ${interaction.drugA.drugName} và ${interaction.drugB.drugName}: ${interaction.description}`,
                    });
                }
            }
        }

        return results;
    }
}
