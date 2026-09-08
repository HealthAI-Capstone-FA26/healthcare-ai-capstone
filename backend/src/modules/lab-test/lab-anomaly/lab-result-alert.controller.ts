import { Controller, Post, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { LabResultDetectionOrchestrator } from './orchestrators/lab-result-detection.orchestrator';

@ApiTags('Lab Results')
@Controller('lab-results')
export class LabResultAlertController {
    constructor(private readonly orchestrator: LabResultDetectionOrchestrator) { }

    /**
     * POST /lab-results/:id/detect-alerts
     * Chạy lại toàn bộ detector (rule + ai) cho 1 LabResult, thường được gọi tự động qua
     * event sau khi nhập/sửa kết quả — endpoint này dùng để chạy lại thủ công khi cần
     * (VD: sau khi ngưỡng tham chiếu LabParameterThreshold được cập nhật).
     */
    @Post(':id/detect-alerts')
    @ApiOperation({
        summary: 'Chạy lại phát hiện bất thường cho 1 kết quả xét nghiệm',
        description:
            'Chạy toàn bộ detector (rule-based + ai) cho LabResult, ghi lại isAbnormal trên từng giá trị ' +
            'và tạo LabResultAlert nếu có bất thường mới.',
    })
    @ApiParam({ name: 'id', description: 'ID kết quả xét nghiệm (labResultId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Kết quả phát hiện bất thường đã gộp theo từng giá trị.' })
    async detectAlerts(@Param('id') labResultId: string) {
        const results = await this.orchestrator.run(labResultId);
        return {
            labResultId,
            totalValues: results.length,
            abnormalCount: results.filter((r) => r.isAbnormal).length,
            results,
        };
    }
}
