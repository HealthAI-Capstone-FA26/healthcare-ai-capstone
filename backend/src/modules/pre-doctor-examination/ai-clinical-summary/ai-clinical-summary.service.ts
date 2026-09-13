import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
    AI_CLINICAL_SUMMARY_PROVIDER,
    AiClinicalSummaryProvider,
} from './ai-clinical-summary-provider.interface';

/**
 * Xử lý AI sinh bản tóm tắt lâm sàng — KHUNG CHỜ TÍCH HỢP (giống hệt pattern
 * AiLabAnalysisService ở module lab-test).
 *
 * Provider thật (AI_CLINICAL_SUMMARY_PROVIDER) CHƯA được bind trong doctor-examination.module.ts
 * — service này do đó hoạt động như no-op an toàn (log rồi bỏ qua) cho tới khi mô-đun AI được
 * triển khai. Không cần sửa gì ở đây/controller khi tích hợp — chỉ cần bind provider thật vào module.
 *
 * TODO khi triển khai thật: đẩy việc gọi AI vào hàng đợi (BullMQ/SQS/...) thay vì gọi trực tiếp
 * trong process API.
 */
@Injectable()
export class AiClinicalSummaryService {
    private readonly logger = new Logger(AiClinicalSummaryService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Optional() @Inject(AI_CLINICAL_SUMMARY_PROVIDER) private readonly provider?: AiClinicalSummaryProvider,
    ) {}

    /** Sinh (hoặc sinh lại) bản tóm tắt cho 1 lượt khám. Gọi thủ công qua API, hoặc tự động khi tích hợp thật. */
    async generate(encounterId: string): Promise<void> {
        if (!this.provider) {
            this.logger.log(
                `Bỏ qua sinh AI clinical summary cho encounter ${encounterId} — mô-đun AI chưa được cấu hình (khung chờ tích hợp).`,
            );
            return;
        }

        const encounter = await this.prisma.encounter.findUnique({ where: { encounterId } });
        if (!encounter) {
            throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
        }

        try {
            const output = await this.provider.generate({ encounterId });

            await this.prisma.$transaction(async (tx) => {
                const summary = await tx.aiClinicalSummary.upsert({
                    where: { encounterId },
                    create: {
                        encounterId,
                        modelName: output.modelName,
                        modelVersion: output.modelVersion,
                        summaryText: output.summaryText,
                        generatedAt: new Date(),
                    },
                    update: {
                        modelName: output.modelName,
                        modelVersion: output.modelVersion,
                        summaryText: output.summaryText,
                        generatedAt: new Date(),
                        status: 'generated',
                    },
                });

                // Mỗi lần sinh lại là 1 bản tóm tắt mới -> thay hoàn toàn bộ nguồn tham chiếu cũ.
                await tx.aiReferenceSource.deleteMany({
                    where: { ownerType: 'clinical_summary', ownerId: summary.summaryId },
                });

                if (output.referenceSources?.length) {
                    await tx.aiReferenceSource.createMany({
                        data: output.referenceSources.map((ref) => ({
                            ownerId: summary.summaryId,
                            ownerType: 'clinical_summary',
                            sourceType: ref.sourceType,
                            sourceId: ref.sourceId,
                            sourceEncounterId: ref.sourceEncounterId,
                            relevanceNote: ref.relevanceNote,
                        })),
                    });
                }
            });

            this.logger.log(`Đã sinh AI clinical summary cho encounter ${encounterId} (model: ${output.modelName}).`);
        } catch (err) {
            this.logger.error(
                `Sinh AI clinical summary thất bại cho encounter ${encounterId}: ${(err as Error).message}`,
                (err as Error).stack,
            );
        }
    }

    /** Đọc bản tóm tắt hiện có (nếu đã sinh) kèm nguồn tham chiếu — trả về null nếu chưa có, KHÔNG throw. */
    async getByEncounterId(encounterId: string) {
        const summary = await this.prisma.aiClinicalSummary.findUnique({ where: { encounterId } });
        if (!summary) {
            return null;
        }

        const referenceSources = await this.prisma.aiReferenceSource.findMany({
            where: { ownerType: 'clinical_summary', ownerId: summary.summaryId },
            orderBy: { createdAt: 'asc' },
        });

        return { ...summary, referenceSources };
    }
}
