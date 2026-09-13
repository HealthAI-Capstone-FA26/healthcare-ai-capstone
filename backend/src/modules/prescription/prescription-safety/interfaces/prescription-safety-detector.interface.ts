import { DrugCatalog, PrescriptionItem } from '@prisma/client';

export type PrescriptionAlertType =
    | 'drug_interaction'
    | 'duplicate_therapeutic_class'
    | 'allergy_contraindication';

export type PrescriptionAlertSeverity = 'mild' | 'moderate' | 'severe' | 'contraindicated';

export interface PrescriptionSafetyDetectionResult {
    alertType: PrescriptionAlertType;
    relatedItemIdA?: string;
    relatedItemIdB?: string;
    severity: PrescriptionAlertSeverity;
    description: string;
}

export type PrescriptionItemWithDrug = PrescriptionItem & { drug: DrugCatalog };

/**
 * Interface chung mà mọi detector (drug interaction, trùng nhóm điều trị, dị ứng...) phải
 * implement — cùng kiểu thiết kế detector/orchestrator đã dùng ở lab-anomaly/vital-anomaly,
 * nhưng chạy ĐỒNG BỘ ngay trong request (không cần event/listener/gateway) theo quyết định
 * 2-A của plan module 9.
 */
export interface PrescriptionSafetyDetector {
    detect(
        prescriptionId: string,
        items: PrescriptionItemWithDrug[],
        patientId: string,
    ): Promise<PrescriptionSafetyDetectionResult[]>;
}
