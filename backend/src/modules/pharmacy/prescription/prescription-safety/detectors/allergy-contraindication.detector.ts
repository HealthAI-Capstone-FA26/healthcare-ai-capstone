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

// Alias duy nhất cho cùng một hoạt chất (không phải mapping nhóm thuốc)
const INGREDIENT_ALIASES: ReadonlyArray<readonly [string, string]> = [
    ['aspirin', 'acetylsalicylic'],
];

function tokenize(str: string): string[] {
    return normalize(str)
        .replace(/ll/g, 'l')
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

function expandAliases(token: string): string[] {
    const candidates = [token];
    for (const [a, b] of INGREDIENT_ALIASES) {
        if (token === a) candidates.push(b);
        else if (token === b) candidates.push(a);
    }
    return candidates;
}

/**
 * So khớp dị nguyên bệnh nhân khai báo với tên thuốc + hoạt chất theo từng token.
 * Giới hạn: chỉ bắt được khi bệnh nhân khai đúng tên hoạt chất; nếu khai theo nhóm
 * (vd "penicillin" cho amoxicillin, "sulfa" cho sulfadiazin) thì sẽ không báo.
 */
export function matchesDrugAllergen(allergen: string, drugName: string, genericName: string): boolean {
    const allergenTokens = tokenize(allergen);
    if (allergenTokens.length === 0) return false;

    const drugTokens = tokenize(`${drugName} ${genericName}`);
    if (drugTokens.length === 0) return false;

    return allergenTokens.every((allergenToken) => {
        const candidates = expandAliases(allergenToken);
        return candidates.some((candidate) =>
            drugTokens.some((drugToken) => drugToken === candidate || drugToken.endsWith(candidate)),
        );
    });
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

        const results: PrescriptionSafetyDetectionResult[] = [];

        for (const item of items) {
            for (const allergen of drugAllergens) {
                if (matchesDrugAllergen(allergen, item.drug.drugName, item.drug.genericName)) {
                    results.push({
                        alertType: 'allergy_contraindication',
                        relatedItemIdA: item.prescriptionItemId,
                        severity: 'contraindicated',
                        description: `Bệnh nhân có tiền sử dị ứng "${allergen}" (ghi nhận trong hồ sơ dị ứng). Thuốc ${item.drug.drugName} (${item.drug.genericName}) có nguy cơ gây dị ứng phản vệ / chống chỉ định.`,
                    });
                    break; // Tránh trùng lặp alert cho cùng 1 dòng thuốc
                }
            }
        }

        return results;
    }
}
