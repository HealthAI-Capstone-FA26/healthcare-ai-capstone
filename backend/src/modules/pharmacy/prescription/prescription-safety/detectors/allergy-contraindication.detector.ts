import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../../prisma/prisma.service';
import {
    PrescriptionItemWithDrug,
    PrescriptionSafetyDetectionResult,
    PrescriptionSafetyDetector,
} from '../interfaces/prescription-safety-detector.interface';

function normalize(str: string): string {
    return str
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

/**
 * Trích xuất danh sách dị nguyên thuốc từ chuỗi allergyText.
 * Quy ước lưu trong schema v2: "[DRUG] drugA, drugB; [FOOD] foodA, foodB; [ENVIRONMENT] envA, envB".
 */
function extractDrugAllergens(allergyText: string): string[] {
    const tokens: string[] = [];
    const groups = allergyText.split(';').map((g) => g.trim()).filter(Boolean);
    let foundDrugSection = false;

    for (const group of groups) {
        const drugMatch = group.match(/^\[DRUG\]\s*(.*)$/i);
        if (drugMatch) {
            foundDrugSection = true;
            const items = drugMatch[1].split(',').map((item) => item.trim()).filter(Boolean);
            tokens.push(...items);
        }
    }

    // Nếu không có tiền tố [DRUG] tường minh, duyệt các phần không gắn tag [FOOD]/[ENVIRONMENT]
    if (!foundDrugSection) {
        for (const group of groups) {
            if (/^\[(FOOD|ENVIRONMENT|OTHER)\]/i.test(group)) {
                continue;
            }
            const clean = group.replace(/^\[.*?\]\s*/, '');
            const items = clean.split(',').map((item) => item.trim()).filter(Boolean);
            tokens.push(...items);
        }
    }

    return [...new Set(tokens)];
}

@Injectable()
export class AllergyContraindicationDetector implements PrescriptionSafetyDetector {
    constructor(private readonly prisma: PrismaService) { }

    async detect(
        _prescriptionId: string,
        items: PrescriptionItemWithDrug[],
        patientId: string,
    ): Promise<PrescriptionSafetyDetectionResult[]> {
        if (!patientId || items.length === 0) return [];

        const activeAllergies = await this.prisma.patientAllergy.findMany({
            where: { patientId, status: 'active' },
            orderBy: { recordedAt: 'desc' },
        });

        if (activeAllergies.length === 0) return [];

        // Gom toàn bộ dị nguyên thuốc từ các bản ghi active (bản ghi mới nhất có đầy đủ nhất)
        const drugAllergens = [
            ...new Set(activeAllergies.flatMap((record) => extractDrugAllergens(record.allergyText))),
        ];

        if (drugAllergens.length === 0) return [];

        // Lấy thông tin nhóm dị nguyên của các thuốc trong đơn
        const categoryIds = [
            ...new Set(
                items
                    .map((item) => item.drug.allergenCategoryId)
                    .filter((id): id is string => Boolean(id)),
            ),
        ];

        const allergenCategories =
            categoryIds.length > 0
                ? await this.prisma.allergenCategory.findMany({
                    where: { categoryId: { in: categoryIds } },
                })
                : [];

        const categoryById = new Map(allergenCategories.map((c) => [c.categoryId, c]));
        const results: PrescriptionSafetyDetectionResult[] = [];

        for (const item of items) {
            const category = item.drug.allergenCategoryId
                ? categoryById.get(item.drug.allergenCategoryId)
                : undefined;

            const drugNameNorm = normalize(item.drug.drugName);
            const genericNameNorm = normalize(item.drug.genericName);
            const categoryNameNorm = category ? normalize(category.categoryName) : '';
            const categoryCodeNorm = category ? normalize(category.categoryCode) : '';

            for (const allergen of drugAllergens) {
                const allergenNorm = normalize(allergen);
                if (!allergenNorm) continue;

                const isMatch =
                    drugNameNorm.includes(allergenNorm) ||
                    genericNameNorm.includes(allergenNorm) ||
                    (categoryNameNorm &&
                        (categoryNameNorm.includes(allergenNorm) || allergenNorm.includes(categoryNameNorm))) ||
                    (categoryCodeNorm && categoryCodeNorm === allergenNorm);

                if (isMatch) {
                    const categoryInfo = category ? `, thuộc nhóm "${category.categoryName}"` : '';
                    results.push({
                        alertType: 'allergy_contraindication',
                        relatedItemIdA: item.prescriptionItemId,
                        severity: 'contraindicated',
                        description: `Bệnh nhân có tiền sử dị ứng "${allergen}" (ghi nhận trong hồ sơ dị ứng). Thuốc ${item.drug.drugName} (${item.drug.genericName}${categoryInfo}) có nguy cơ gây dị ứng phản vệ / chống chỉ định.`,
                    });
                    break; // Tránh trùng lặp alert cho cùng 1 dòng thuốc
                }
            }
        }

        return results;
    }
}
