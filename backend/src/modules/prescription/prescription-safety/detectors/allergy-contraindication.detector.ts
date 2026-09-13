import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import {
    PrescriptionItemWithDrug,
    PrescriptionSafetyDetectionResult,
    PrescriptionSafetyDetector,
} from '../interfaces/prescription-safety-detector.interface';

const SEVERE_ALLERGY_LEVELS = new Set(['severe', 'life_threatening']);

/**
 * Lấy PatientAllergy đang active của bệnh nhân, so allergenName (không phân biệt hoa
 * thường, khớp gần đúng theo substring) và substanceCode với AllergenCategory của từng
 * thuốc trong đơn (qua DrugCatalog.allergenCategoryId). Thuốc không gắn allergenCategoryId
 * (allergenCategoryId = null) coi như không có nhóm dị nguyên nào để đối chiếu, bỏ qua.
 */
@Injectable()
export class AllergyContraindicationDetector implements PrescriptionSafetyDetector {
    constructor(private readonly prisma: PrismaService) {}

    private isMatch(allergenName: string, substanceCode: string | null, categoryName: string, categoryCode: string): boolean {
        const normalizedAllergen = allergenName.trim().toLowerCase();
        const normalizedCategoryName = categoryName.trim().toLowerCase();

        if (normalizedAllergen && normalizedCategoryName) {
            if (
                normalizedAllergen.includes(normalizedCategoryName) ||
                normalizedCategoryName.includes(normalizedAllergen)
            ) {
                return true;
            }
        }

        if (substanceCode && substanceCode.trim().toLowerCase() === categoryCode.trim().toLowerCase()) {
            return true;
        }

        return false;
    }

    async detect(
        _prescriptionId: string,
        items: PrescriptionItemWithDrug[],
        patientId: string,
    ): Promise<PrescriptionSafetyDetectionResult[]> {
        const itemsWithAllergenCategory = items.filter((item) => item.drug.allergenCategoryId);
        if (itemsWithAllergenCategory.length === 0) return [];

        const [allergies, allergenCategories] = await Promise.all([
            this.prisma.patientAllergy.findMany({ where: { patientId, status: 'active' } }),
            this.prisma.allergenCategory.findMany({
                where: { categoryId: { in: itemsWithAllergenCategory.map((item) => item.drug.allergenCategoryId!) } },
            }),
        ]);

        if (allergies.length === 0) return [];

        const categoryById = new Map(allergenCategories.map((c) => [c.categoryId, c]));
        const results: PrescriptionSafetyDetectionResult[] = [];

        for (const item of itemsWithAllergenCategory) {
            const category = categoryById.get(item.drug.allergenCategoryId!);
            if (!category) continue;

            for (const allergy of allergies) {
                if (!this.isMatch(allergy.allergenName, allergy.substanceCode, category.categoryName, category.categoryCode)) {
                    continue;
                }

                const severity: PrescriptionSafetyDetectionResult['severity'] = SEVERE_ALLERGY_LEVELS.has(allergy.severity)
                    ? 'contraindicated'
                    : 'severe';

                results.push({
                    alertType: 'allergy_contraindication',
                    relatedItemIdA: item.prescriptionItemId,
                    severity,
                    description: `${item.drug.drugName} thuộc nhóm dị nguyên "${category.categoryName}" — bệnh nhân có tiền sử dị ứng "${allergy.allergenName}" (mức độ: ${allergy.severity}).`,
                });
            }
        }

        return results;
    }
}
