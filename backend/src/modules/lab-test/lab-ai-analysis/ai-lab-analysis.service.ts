import { Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import {
    AI_LAB_ANALYSIS_PROVIDER,
    AiLabAnalysisProvider,
    AiLabAnalysisInput,
} from './ai-lab-analysis-provider.interface';

/**
 * Xử lý AI & phân tích tự động — KHUNG CHỜ TÍCH HỢP.
 * Chuyển dữ liệu xét nghiệm (bảng số liệu + hình ảnh đính kèm) sang mô-đun AI để phát hiện,
 * khoanh vùng/làm nổi bật tổn thương (nếu có) và đưa ra chẩn đoán hỗ trợ.
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
    ) {}

    /** Gọi bởi LabResultDetectionListener sau khi kết quả được lưu — fire-and-forget. */
    async enqueueAnalysis(labResultId: string): Promise<void> {
        if (!this.provider) {
            this.logger.log(
                `Bỏ qua AI lab analysis cho ${labResultId} — mô-đun AI chưa được cấu hình (khung chờ tích hợp).`,
            );
            return;
        }

        const input = await this.buildInput(labResultId);
        const output = await this.provider.analyze(input);

        await this.prisma.aiLabAnalysis.create({
            data: {
                labResultId,
                modelName: output.modelName,
                modelVersion: output.modelVersion,
                overallFinding: output.overallFinding,
                confidenceScore: output.confidenceScore,
                analyzedAt: new Date(),
            },
        });

        this.logger.log(`Đã lưu kết quả AI lab analysis cho ${labResultId} (model: ${output.modelName}).`);
    }

    async listByLabResult(labResultId: string) {
        return this.prisma.aiLabAnalysis.findMany({
            where: { labResultId },
            orderBy: { analyzedAt: 'desc' },
        });
    }

    private async buildInput(labResultId: string): Promise<AiLabAnalysisInput> {
        const labResult = await this.prisma.labResult.findUnique({
            where: { labResultId },
            include: {
                values: { include: { parameter: true } },
                attachments: true,
                medicalImages: true,
            },
        });

        if (!labResult) {
            throw new NotFoundException(`Không tìm thấy kết quả xét nghiệm ${labResultId}`);
        }

        const imageUrls = [
            ...labResult.attachments.filter((a) => a.fileType === 'image' || a.fileType === 'pdf').map((a) => a.fileUrl),
            // MedicalImage không nằm trong schema trích dẫn cho module này — TODO: map đúng field URL thật
            // (ví dụ `imageUrl` hoặc `dicomUrl`) nếu model MedicalImage có cấu trúc khác.
            ...(labResult.medicalImages ?? []).map((img) => (img as unknown as { imageUrl?: string }).imageUrl).filter(Boolean),
        ] as string[];

        return {
            labResultId,
            imageUrls,
            values: labResult.values.map((v) => ({
                parameterCode: v.parameter.parameterCode,
                parameterName: v.parameter.parameterName,
                valueNumeric: v.valueNumeric !== null && v.valueNumeric !== undefined ? Number(v.valueNumeric) : null,
                valueText: v.valueText,
                unit: v.parameter.unit,
            })),
        };
    }
}
