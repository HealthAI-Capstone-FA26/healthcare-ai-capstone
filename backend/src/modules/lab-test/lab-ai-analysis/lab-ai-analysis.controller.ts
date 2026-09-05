import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AiLabAnalysisService } from './ai-lab-analysis.service';

/**
 * API cho khung AI phân tích xét nghiệm. Nội dung phân tích thật sẽ được đổ vào khi
 * mô-đun AI (phát hiện/khoanh vùng tổn thương, chẩn đoán hỗ trợ) được triển khai —
 * hiện tại các endpoint dưới đây hoạt động dựa trên AiLabAnalysisService (no-op an toàn
 * cho tới khi có provider thật).
 */
@ApiTags('Lab AI Analysis')
@Controller('lab-results/:labResultId/ai-analyses')
export class LabAiAnalysisController {
    constructor(private readonly aiLabAnalysisService: AiLabAnalysisService) {}

    @Get()
    @ApiOperation({
        summary: 'Danh sách kết quả phân tích AI của 1 kết quả xét nghiệm',
        description: 'Trả về các lần phân tích AI (nếu có) — chẩn đoán hỗ trợ, độ tin cậy, mô hình sử dụng.',
    })
    @ApiParam({ name: 'labResultId', description: 'ID kết quả xét nghiệm', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách AiLabAnalysis, mới nhất trước.' })
    async list(@Param('labResultId') labResultId: string) {
        return this.aiLabAnalysisService.listByLabResult(labResultId);
    }

    /**
     * POST /lab-results/:labResultId/ai-analyses/run
     * Chạy lại phân tích AI thủ công (VD: sau khi có thêm ảnh đính kèm mới).
     * Hiện là no-op cho tới khi provider AI thật được bind vào module.
     */
    @Post('run')
    @ApiOperation({
        summary: 'Chạy lại phân tích AI thủ công',
        description: 'Thường được kích hoạt tự động sau khi nhập kết quả — endpoint này dùng để chạy lại thủ công khi cần.',
    })
    @ApiParam({ name: 'labResultId', description: 'ID kết quả xét nghiệm', format: 'uuid' })
    @ApiOkResponse({ description: 'Đã yêu cầu chạy phân tích AI (xử lý bất đồng bộ).' })
    async run(@Param('labResultId') labResultId: string) {
        await this.aiLabAnalysisService.enqueueAnalysis(labResultId);
        return { labResultId, status: 'requested' };
    }
}
