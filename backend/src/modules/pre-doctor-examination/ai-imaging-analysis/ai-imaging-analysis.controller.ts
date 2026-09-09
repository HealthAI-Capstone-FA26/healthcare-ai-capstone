import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AiImagingAnalysisService } from './ai-imaging-analysis.service';

/**
 * API cho khung AI phân tích hình ảnh y khoa (khoanh vùng bất thường). `generate` là no-op an
 * toàn nếu mô-đun AI chưa được cấu hình (xem AiImagingAnalysisService).
 */
@ApiTags('Doctor Examination - AI Imaging Analysis')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('doctor-examination')
export class AiImagingAnalysisController {
    constructor(private readonly aiImagingAnalysisService: AiImagingAnalysisService) {}

    @Post('medical-images/:imageId/ai-analysis/generate')
    @ApiOperation({ summary: 'Yêu cầu AI phân tích 1 hình ảnh y khoa (khoanh vùng bất thường)' })
    @ApiParam({ name: 'imageId', format: 'uuid' })
    async generate(@Param('imageId') imageId: string) {
        const result = await this.aiImagingAnalysisService.analyzeImage(imageId);
        return result ?? { imageId, status: 'requested' };
    }

    @Get('medical-images/:imageId/ai-analysis')
    @ApiOperation({ summary: 'Xem các kết luận AI đã phân tích cho 1 hình ảnh y khoa' })
    @ApiParam({ name: 'imageId', format: 'uuid' })
    listByImage(@Param('imageId') imageId: string) {
        return this.aiImagingAnalysisService.listByImage(imageId);
    }

    @Get('patients/:patientId/imaging-history')
    @ApiOperation({
        summary: 'Lịch sử hình ảnh y khoa của bệnh nhân (mọi lượt khám) kèm kết luận AI',
        description:
            'Dùng cho bác sĩ xem lại ở bước "Xem thông tin & Đánh giá từ AI" trước khi khám lâm sàng (Module 5).',
    })
    @ApiParam({ name: 'patientId', format: 'uuid' })
    @ApiQuery({ name: 'limit', required: false, type: Number })
    @ApiOkResponse({ description: 'Danh sách hình ảnh, mới nhất trước, kèm kết luận AI nếu có.' })
    listImagingHistory(@Param('patientId') patientId: string, @Query('limit') limit?: string) {
        return this.aiImagingAnalysisService.listImagingHistoryByPatient(patientId, limit ? Number(limit) : undefined);
    }
}
