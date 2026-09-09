import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { getEncounterLabResults } from '../shared/encounter-lab-results.util';
import {
    AI_DIAGNOSIS_REVIEW_PROVIDER,
    AiDiagnosisReviewAbnormalLabFinding,
    AiDiagnosisReviewProvider,
} from './ai-diagnosis-review-provider.interface';

const SOURCE_TYPE = 'comprehensive_review';
const OWNER_TYPE = 'diagnosis_suggestion'; // trùng owner_type dùng bởi Module 5, xem AiReferenceSource.ownerType

/**
 * Xử lý AI gợi ý chẩn đoán TOÀN DIỆN sau xét nghiệm (Module 8, mục "Đề xuất chẩn đoán từ AI") —
 * KHUNG CHỜ TÍCH HỢP, cùng pattern InitialDiagnosisSuggestionService (Module 5) và
 * AiLabAnalysisService (Module 7).
 *
 * Provider thật (AI_DIAGNOSIS_REVIEW_PROVIDER) CHƯA được bind trong post-test-consultation.module.ts
 * — service này hoạt động như no-op an toàn (log rồi bỏ qua, trả về mảng rỗng) cho tới khi được
 * cấu hình. Không cần sửa gì ở đây/controller khi tích hợp thật — chỉ cần bind provider vào module.
 *
 * TODO khi triển khai thật: đẩy việc gọi AI vào hàng đợi (BullMQ/SQS/...) thay vì gọi trực tiếp
 * trong process API.
 */
@Injectable()
export class AiDiagnosisReviewService {
    private readonly logger = new Logger(AiDiagnosisReviewService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Optional()
        @Inject(AI_DIAGNOSIS_REVIEW_PROVIDER)
        private readonly provider?: AiDiagnosisReviewProvider,
    ) {}

    /** Sinh (hoặc sinh lại toàn bộ) top-k gợi ý chẩn đoán toàn diện cho 1 lượt khám. */
    async generate(encounterId: string) {
        if (!this.provider) {
            this.logger.log(
                `Bỏ qua sinh AI diagnosis review cho encounter ${encounterId} — mô-đun AI chưa được cấu hình (khung chờ tích hợp).`,
            );
            return [];
        }

        const encounter = await this.prisma.encounter.findUnique({
            where: { encounterId },
            include: {
                chiefComplaint: true,
                clinicalExamination: true,
                aiClinicalSummary: true,
                diagnoses: { where: { diagnosisType: 'preliminary' }, include: { icd10: true } },
            },
        });
        if (!encounter) {
            throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
        }

        const abnormalLabFindings = await this.getAbnormalLabFindings(encounterId);

        try {
            const output = await this.provider.review({
                encounterId,
                symptoms: encounter.chiefComplaint?.symptoms ?? undefined,
                examinationFindings: encounter.clinicalExamination?.examinationFindings ?? undefined,
                clinicalSummaryText: encounter.aiClinicalSummary?.summaryText ?? undefined,
                preliminaryDiagnoses: encounter.diagnoses.map((d) => ({
                    icd10Code: d.icd10Code,
                    diagnosisName: d.diagnosisName,
                })),
                abnormalLabFindings,
            });

            const created: { suggestionId: string }[] = [];

            await this.prisma.$transaction(async (tx) => {
                // Mỗi lần sinh lại thay thế hoàn toàn bộ top-k comprehensive_review cũ của lượt khám này
                // — KHÔNG đụng tới các gợi ý initial_summary do Module 5 tạo (khác sourceType).
                const stale = await tx.aiDiagnosisSuggestion.findMany({
                    where: { encounterId, sourceType: SOURCE_TYPE },
                    select: { suggestionId: true },
                });
                if (stale.length) {
                    const staleIds = stale.map((s) => s.suggestionId);
                    await tx.aiReferenceSource.deleteMany({ where: { ownerType: OWNER_TYPE, ownerId: { in: staleIds } } });
                    await tx.aiDiagnosisSuggestion.deleteMany({ where: { suggestionId: { in: staleIds } } });
                }

                for (const item of output.suggestions) {
                    const icd10 = await tx.icd10Code.findUnique({ where: { icd10Code: item.icd10Code } });
                    if (!icd10) {
                        this.logger.warn(
                            `AI trả về mã ICD-10 không tồn tại '${item.icd10Code}' cho encounter ${encounterId} — bỏ qua gợi ý này.`,
                        );
                        continue;
                    }

                    const suggestion = await tx.aiDiagnosisSuggestion.create({
                        data: {
                            encounterId,
                            sourceType: SOURCE_TYPE,
                            explanationText: item.explanationText,
                            modelName: output.modelName,
                            modelVersion: output.modelVersion,
                            icd10Code: item.icd10Code,
                            suggestedDiagName: item.suggestedDiagName,
                            confidenceScore: item.confidenceScore,
                            rank: item.rank,
                            generatedAt: new Date(),
                        },
                    });

                    if (item.referenceSources?.length) {
                        await tx.aiReferenceSource.createMany({
                            data: item.referenceSources.map((ref) => ({
                                ownerId: suggestion.suggestionId,
                                ownerType: OWNER_TYPE,
                                sourceType: ref.sourceType,
                                sourceId: ref.sourceId,
                                sourceEncounterId: ref.sourceEncounterId,
                                relevanceNote: ref.relevanceNote,
                            })),
                        });
                    }

                    created.push(suggestion);
                }
            });

            this.logger.log(`Đã sinh ${created.length} gợi ý chẩn đoán toàn diện cho encounter ${encounterId}.`);
            return this.listByEncounterId(encounterId);
        } catch (err) {
            this.logger.error(
                `Sinh AI diagnosis review thất bại cho encounter ${encounterId}: ${(err as Error).message}`,
                (err as Error).stack,
            );
            return [];
        }
    }

    /** Đọc top-k gợi ý chẩn đoán toàn diện hiện có (kèm nguồn tham chiếu) — trả mảng rỗng nếu chưa sinh. */
    async listByEncounterId(encounterId: string) {
        const suggestions = await this.prisma.aiDiagnosisSuggestion.findMany({
            where: { encounterId, sourceType: SOURCE_TYPE },
            orderBy: { rank: 'asc' },
            include: { icd10: true, reviewedByUser: true },
        });
        if (!suggestions.length) {
            return [];
        }

        const suggestionIds = suggestions.map((s) => s.suggestionId);
        const referenceSources = await this.prisma.aiReferenceSource.findMany({
            where: { ownerType: OWNER_TYPE, ownerId: { in: suggestionIds } },
        });

        return suggestions.map((suggestion) => ({
            ...suggestion,
            referenceSources: referenceSources.filter((ref) => ref.ownerId === suggestion.suggestionId),
        }));
    }

    /**
     * Gom các giá trị xét nghiệm bất thường (isAbnormal=true) của lượt khám thành input dễ đọc cho AI.
     * Ưu tiên lấy risk_level từ LabResultAlert (đã qua rule/AI detector ở Module 7) nếu có; nếu
     * value bị đánh dấu bất thường nhưng chưa (hoặc không) phát sinh alert, vẫn đưa vào danh sách
     * kèm riskLevel để trống — an toàn hơn là bỏ sót.
     */
    private async getAbnormalLabFindings(encounterId: string): Promise<AiDiagnosisReviewAbnormalLabFinding[]> {
        const labResultRows = await getEncounterLabResults(this.prisma, encounterId);
        const abnormalValues = labResultRows.flatMap((row) =>
            row.labResult.values
                .filter((v) => v.isAbnormal)
                .map((v) => ({ row, value: v })),
        );

        if (!abnormalValues.length) {
            return [];
        }

        const alerts = await this.prisma.labResultAlert.findMany({
            where: { encounterId, resultValueId: { in: abnormalValues.map((a) => a.value.resultValueId) } },
        });
        const riskByValueId = new Map<string, string>(alerts.map((a) => [a.resultValueId, a.riskLevel]));

        return abnormalValues.map(({ row, value }) => ({
            testName: row.testName,
            parameterName: (value.parameter.parameterName ?? value.parameter.parameterCode) as string,
            measuredValue: value.valueNumeric?.toString() ?? value.valueText ?? '',
            unit: value.parameter.unit ?? undefined,
            riskLevel: riskByValueId.get(value.resultValueId),
        }));
    }
}
