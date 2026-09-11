import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
    INITIAL_DIAGNOSIS_SUGGESTION_PROVIDER,
    InitialDiagnosisSuggestionProvider,
} from './initial-diagnosis-suggestion-provider.interface';

const SOURCE_TYPE = 'initial_summary';
const OWNER_TYPE = 'diagnosis_suggestion';

/**
 * Xử lý AI gợi ý chẩn đoán sơ bộ (trước xét nghiệm) — KHUNG CHỜ TÍCH HỢP, cùng pattern
 * AiLabAnalysisService ở module lab-test.
 *
 * Provider thật (INITIAL_DIAGNOSIS_SUGGESTION_PROVIDER) CHƯA được bind trong
 * doctor-examination.module.ts — service này hoạt động như no-op an toàn (log rồi bỏ qua, trả về
 * mảng rỗng) cho tới khi được cấu hình.
 *
 * TODO khi triển khai thật: đẩy việc gọi AI vào hàng đợi (BullMQ/SQS/...) thay vì gọi trực tiếp
 * trong process API.
 */
@Injectable()
export class InitialDiagnosisSuggestionService {
    private readonly logger = new Logger(InitialDiagnosisSuggestionService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Optional()
        @Inject(INITIAL_DIAGNOSIS_SUGGESTION_PROVIDER)
        private readonly provider?: InitialDiagnosisSuggestionProvider,
    ) {}

    /** Sinh (hoặc sinh lại toàn bộ) top-k gợi ý chẩn đoán sơ bộ cho 1 lượt khám. */
    async generate(encounterId: string) {
        if (!this.provider) {
            this.logger.log(
                `Bỏ qua sinh AI initial diagnosis suggestion cho encounter ${encounterId} — mô-đun AI chưa được cấu hình (khung chờ tích hợp).`,
            );
            return [];
        }

        const encounter = await this.prisma.encounter.findUnique({
            where: { encounterId },
            include: { chiefComplaint: true, clinicalExamination: true, aiClinicalSummary: true },
        });
        if (!encounter) {
            throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
        }

        try {
            const output = await this.provider.suggest({
                encounterId,
                symptoms: encounter.chiefComplaint?.symptoms ?? undefined,
                examinationFindings: encounter.clinicalExamination?.examinationFindings ?? undefined,
                clinicalSummaryText: encounter.aiClinicalSummary?.summaryText ?? undefined,
            });

            const created: { suggestionId: string }[] = [];

            await this.prisma.$transaction(async (tx) => {
                // Mỗi lần sinh lại thay thế hoàn toàn bộ top-k initial_summary cũ của lượt khám này.
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

            this.logger.log(`Đã sinh ${created.length} gợi ý chẩn đoán sơ bộ cho encounter ${encounterId}.`);
            return this.listByEncounterId(encounterId);
        } catch (err) {
            this.logger.error(
                `Sinh AI initial diagnosis suggestion thất bại cho encounter ${encounterId}: ${(err as Error).message}`,
                (err as Error).stack,
            );
            return [];
        }
    }

    /** Đọc top-k gợi ý chẩn đoán sơ bộ hiện có (kèm nguồn tham chiếu) — trả mảng rỗng nếu chưa sinh. */
    async listByEncounterId(encounterId: string) {
        const suggestions = await this.prisma.aiDiagnosisSuggestion.findMany({
            where: { encounterId, sourceType: SOURCE_TYPE },
            orderBy: { rank: 'asc' },
            include: { icd10: true },
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
}
