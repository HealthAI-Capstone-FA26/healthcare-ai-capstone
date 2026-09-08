import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AI_LAB_ANALYSIS_PROVIDER, AiLabAnalysisProvider } from './ai-lab-analysis-provider.interface';

/**
 * Xử lý AI & phân tích tự động — KHUNG CHỜ TÍCH HỢP.
 * Với TỪNG hình ảnh đính kèm của 1 lab result, đưa ra kết luận nhị phân "ảnh này có bất
 * thường (anomaly) hay không" — kết luận CHỈ dựa trên bản thân ảnh đó, KHÔNG đối chiếu chéo
 * với bảng số liệu kết quả hay bất kỳ yếu tố nào khác (tuổi/giới tính bệnh nhân, chỉ số xét
 * nghiệm...).
 *
 * Provider thật (AI_LAB_ANALYSIS_PROVIDER) CHƯA được bind trong lab-test.module.ts — service này
 * do đó hoạt động như no-op an toàn (log rồi bỏ qua) cho tới khi mô-đun AI được triển khai.
 * Không cần sửa gì ở đây/listener/controller khi tích hợp — chỉ cần bind provider thật vào module.
 *
 * TODO khi triển khai thật: đẩy việc gọi AI vào hàng đợi (BullMQ/SQS/...) thay vì gọi trực tiếp
 * trong process API, để chịu được khối lượng lớn & retry khi model AI phản hồi chậm/lỗi.
 */
@Injectable()
export class AiLabAnalysisService {
    private readonly logger = new Logger(AiLabAnalysisService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Optional() @Inject(AI_LAB_ANALYSIS_PROVIDER) private readonly provider?: AiLabAnalysisProvider,
    ) { }

    /**
     * Gọi bởi LabResultDetectionListener sau khi kết quả được lưu — fire-and-forget.
     * Phân tích RIÊNG TỪNG ảnh đính kèm (1 lời gọi provider.analyze() / ảnh, chỉ truyền
     * `imageUrl` — không kèm bảng số liệu hay dữ liệu nào khác) và lưu 1 bản ghi AiLabAnalysis
     * / ảnh, thay vì gộp chung 1 kết luận cho toàn bộ lab result.
     */
    async enqueueAnalysis(labResultId: string): Promise<void> {
        if (!this.provider) {
            this.logger.log(
                `Bỏ qua AI lab analysis cho ${labResultId} — mô-đun AI chưa được cấu hình (khung chờ tích hợp).`,
            );
            return;
        }

        const imageUrls = await this.getImageUrls(labResultId);

        if (imageUrls.length === 0) {
            this.logger.log(`Không có ảnh đính kèm để phân tích AI cho ${labResultId} — bỏ qua.`);
            return;
        }

        for (const imageUrl of imageUrls) {
            try {
                const output = await this.provider.analyze({ labResultId, imageUrl });

                await this.prisma.aiLabAnalysis.create({
                    data: {
                        labResultId,
                        imageUrl,
                        modelName: output.modelName,
                        modelVersion: output.modelVersion,
                        isAnomaly: output.isAnomaly,
                        finding: output.finding,
                        confidenceScore: output.confidenceScore,
                        analyzedAt: new Date(),
                    },
                });

                this.logger.log(
                    `Đã lưu kết luận AI cho ảnh của lab result ${labResultId} ` +
                    `(model: ${output.modelName}, isAnomaly: ${output.isAnomaly}).`,
                );
            } catch (err) {
                // Lỗi phân tích 1 ảnh không được làm hỏng việc phân tích các ảnh còn lại.
                this.logger.error(
                    `Phân tích AI thất bại cho 1 ảnh của lab result ${labResultId}: ${(err as Error).message}`,
                    (err as Error).stack,
                );
            }
        }
    }

    async listByLabResult(labResultId: string) {
        return this.prisma.aiLabAnalysis.findMany({
            where: { labResultId },
            orderBy: { analyzedAt: 'desc' },
        });
    }

    private async getImageUrls(labResultId: string): Promise<string[]> {
        const labResult = await this.prisma.labResult.findUnique({
            where: { labResultId },
            include: {
                attachments: true,
                medicalImages: true,
            },
        });

        if (!labResult) {
            throw new NotFoundException(`Không tìm thấy kết quả xét nghiệm ${labResultId}`);
        }

        return [
            ...labResult.attachments.filter((a) => a.fileType === 'image' || a.fileType === 'pdf').map((a) => a.fileUrl),
            ...labResult.medicalImages.map((img) => img.fileUrl).filter((url): url is string => !!url),
        ];
    }
}
