import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { AiLabAnalysisService } from './ai-lab-analysis.service';

/**
 * API cho khung AI phân tích xét nghiệm. Nội dung phân tích thật sẽ được đổ vào khi
 * mô-đun AI được triển khai — phạm vi CHỈ dừng ở mức kết luận nhị phân cho TỪNG ảnh đính kèm
 * ("ảnh này có bất thường/anomaly hay không" + độ tin cậy)
 */
@ApiTags('Lab AI Analysis')
@Controller('lab-results/:labResultId/ai-analyses')
export class LabAiAnalysisController {
    constructor(private readonly aiLabAnalysisService: AiLabAnalysisService) { }

    @Get()
    @ApiOperation({
        summary: 'Danh sách kết luận AI theo từng ảnh của 1 kết quả xét nghiệm',
        description:
            'Trả về các lần phân tích AI (nếu có) — mỗi bản ghi ứng với kết luận anomaly hay không của 1 ảnh, ' +
            'kèm độ tin cậy và mô hình sử dụng.',
    })
    @ApiParam({ name: 'labResultId', description: 'ID kết quả xét nghiệm', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách AiLabAnalysis, mới nhất trước.' })
    async list(@Param('labResultId') labResultId: string) {
        return this.aiLabAnalysisService.listByLabResult(labResultId);
    }
}
