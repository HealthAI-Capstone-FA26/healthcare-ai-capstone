import { Injectable } from '@nestjs/common';
import {
    PrescriptionItemWithDrug,
    PrescriptionSafetyDetectionResult,
    PrescriptionSafetyDetector,
} from '../interfaces/prescription-safety-detector.interface';

/**
 * Gom item theo DrugCatalog.therapeuticClass (bỏ qua null) — class nào có ≥2 thuốc trong
 * cùng đơn thì sinh 1 alert (nguy cơ trùng lặp nhóm điều trị / quá liều cộng dồn).
 */
@Injectable()
export class DuplicateTherapeuticClassDetector implements PrescriptionSafetyDetector {
    async detect(
        _prescriptionId: string,
        items: PrescriptionItemWithDrug[],
        _patientId: string,
    ): Promise<PrescriptionSafetyDetectionResult[]> {
        const byClass = new Map<string, PrescriptionItemWithDrug[]>();

        for (const item of items) {
            const therapeuticClass = item.drug.therapeuticClass;
            if (!therapeuticClass) continue;

            const bucket = byClass.get(therapeuticClass) ?? [];
            bucket.push(item);
            byClass.set(therapeuticClass, bucket);
        }

        const results: PrescriptionSafetyDetectionResult[] = [];

        for (const [therapeuticClass, groupItems] of byClass) {
            if (groupItems.length < 2) continue;

            // Sinh alert cho mọi cặp trong nhóm, để mỗi cặp dòng thuốc trùng lớp đều được
            // liên kết rõ ràng qua relatedItemIdA/B (nhất quán với DrugInteractionDetector).
            for (let i = 0; i < groupItems.length; i++) {
                for (let j = i + 1; j < groupItems.length; j++) {
                    const itemA = groupItems[i];
                    const itemB = groupItems[j];
                    results.push({
                        alertType: 'duplicate_therapeutic_class',
                        relatedItemIdA: itemA.prescriptionItemId,
                        relatedItemIdB: itemB.prescriptionItemId,
                        severity: 'moderate',
                        description: `${itemA.drug.drugName} và ${itemB.drug.drugName} cùng      nhóm điều trị "${therapeuticClass}" — nguy cơ trùng lặp/quá liều cộng dồn.`,
                    });
                }
            }
        }

        return results;
    }
}
