import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
    AI_IMAGING_ANALYSIS_PROVIDER,
    AiImagingAnalysisProvider,
} from './ai-imaging-analysis-provider.interface';

const DEFAULT_IMAGING_HISTORY_LIMIT = 10;

/**
 * Xử lý AI phân tích hình ảnh y khoa (khoanh vùng bất thường) — KHUNG CHỜ TÍCH HỢP, cùng pattern
 * AiLabAnalysisService ở module lab-test. Chạy TRÊN TỪNG MedicalImage — không giới hạn ảnh phải
 * thuộc lượt khám hiện tại, vì mục đích ở Module 5 là cho bác sĩ xem lại lịch sử hình ảnh đã có
 * của bệnh nhân (từ các lượt khám/lab trước) trước khi ra chẩn đoán sơ bộ.
 *
 * Provider thật (AI_IMAGING_ANALYSIS_PROVIDER) CHƯA được bind trong doctor-examination.module.ts
 * — service này hoạt động như no-op an toàn (log rồi bỏ qua) cho tới khi được cấu hình.
 *
 * TODO khi triển khai thật: đẩy việc gọi AI vào hàng đợi (BullMQ/SQS/...) thay vì gọi trực tiếp
 * trong process API.
 */
@Injectable()
export class AiImagingAnalysisService {
    private readonly logger = new Logger(AiImagingAnalysisService.name);

    constructor(
        private readonly prisma: PrismaService,
        @Optional() @Inject(AI_IMAGING_ANALYSIS_PROVIDER) private readonly provider?: AiImagingAnalysisProvider,
    ) {}

    /** Phân tích 1 ảnh cụ thể, lưu 1 bản ghi AiImagingAnalysis kèm các AiImagingFinding (nếu có). */
    async analyzeImage(medicalImageId: string) {
        if (!this.provider) {
            this.logger.log(
                `Bỏ qua AI imaging analysis cho ảnh ${medicalImageId} — mô-đun AI chưa được cấu hình (khung chờ tích hợp).`,
            );
            return null;
        }

        const image = await this.prisma.medicalImage.findUnique({ where: { imageId: medicalImageId } });
        if (!image) {
            throw new NotFoundException(`Không tìm thấy hình ảnh y khoa ${medicalImageId}`);
        }
        if (!image.fileUrl) {
            throw new BadRequestException(`Hình ảnh ${medicalImageId} chưa có fileUrl để phân tích`);
        }

        try {
            const output = await this.provider.analyze({
                medicalImageId,
                imageUrl: image.fileUrl,
                imageType: image.imageType,
            });

            const analysis = await this.prisma.aiImagingAnalysis.create({
                data: {
                    imageId: medicalImageId,
                    modelName: output.modelName,
                    modelVersion: output.modelVersion,
                    overallFinding: output.overallFinding,
                    confidenceScore: output.confidenceScore,
                    annotatedImageUrl: output.annotatedImageUrl,
                    analyzedAt: new Date(),
                    findings: {
                        create: output.findings.map((finding) => ({
                            findingLabel: finding.findingLabel,
                            confidenceScore: finding.confidenceScore,
                            boundingBox: finding.boundingBox as unknown as Prisma.InputJsonValue,
                            severity: finding.severity,
                        })),
                    },
                },
                include: { findings: true },
            });

            this.logger.log(
                `Đã lưu kết luận AI imaging analysis cho ảnh ${medicalImageId} ` +
                    `(model: ${output.modelName}, ${output.findings.length} vùng bất thường).`,
            );
            return analysis;
        } catch (err) {
            this.logger.error(
                `Phân tích AI imaging thất bại cho ảnh ${medicalImageId}: ${(err as Error).message}`,
                (err as Error).stack,
            );
            return null;
        }
    }

    async listByImage(medicalImageId: string) {
        return this.prisma.aiImagingAnalysis.findMany({
            where: { imageId: medicalImageId },
            orderBy: { analyzedAt: 'desc' },
            include: { findings: true },
        });
    }

    /**
     * Lịch sử hình ảnh y khoa của 1 bệnh nhân (mọi lượt khám), kèm kết luận AI (nếu đã phân tích) —
     * dùng để bác sĩ xem lại ở bước "Xem thông tin & Đánh giá từ AI" trước khi khám (Module 5, mục 1).
     */
    async listImagingHistoryByPatient(patientId: string, limit = DEFAULT_IMAGING_HISTORY_LIMIT) {
        return this.prisma.medicalImage.findMany({
            where: { patientId },
            orderBy: { capturedAt: 'desc' },
            take: limit,
            include: { aiImagingAnalyses: { include: { findings: true }, orderBy: { analyzedAt: 'desc' } } },
        });
    }
}
