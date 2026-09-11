import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { Icd10CatalogService } from '../../shared/icd10-catalog/icd10-catalog.service';

const PRIORITY_ORDER: Record<string, number> = { recommended: 0, optional: 1 };

/**
 * Module 5, mục "Gợi ý chỉ định": hệ thống tự động gợi ý danh mục xét nghiệm phù hợp dựa trên
 * chẩn đoán sơ bộ của bác sĩ. Đây là logic NGHIỆP VỤ THẬT (tra bảng DiagnosisTestRecommendation
 * đã seed sẵn theo mã ICD-10), KHÔNG phải phần AI cần khung chờ tích hợp.
 */
@Injectable()
export class TestRecommendationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly icd10CatalogService: Icd10CatalogService,
    ) {}

    async byIcd10Code(icd10Code: string) {
        // Đảm bảo mã tồn tại để trả lỗi rõ ràng thay vì trả mảng rỗng gây hiểu nhầm "không có gợi ý".
        await this.icd10CatalogService.getByCode(icd10Code);

        const recommendations = await this.prisma.diagnosisTestRecommendation.findMany({
            where: { icd10Code, isActive: true },
            include: { testType: true },
        });

        return recommendations.sort((a, b) => {
            const priorityDiff = (PRIORITY_ORDER[a.priority] ?? 99) - (PRIORITY_ORDER[b.priority] ?? 99);
            if (priorityDiff !== 0) return priorityDiff;
            return a.testType.testName.localeCompare(b.testType.testName);
        });
    }

    async byDiagnosisId(diagnosisId: string) {
        const diagnosis = await this.prisma.diagnosis.findUnique({ where: { diagnosisId } });
        if (!diagnosis) {
            throw new NotFoundException(`Không tìm thấy chẩn đoán ${diagnosisId}`);
        }
        return this.byIcd10Code(diagnosis.icd10Code);
    }
}
