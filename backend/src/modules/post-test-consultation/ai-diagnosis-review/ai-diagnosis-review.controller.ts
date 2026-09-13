import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AiDiagnosisReviewService } from './ai-diagnosis-review.service';

/**
 * API cho khung AI gợi ý chẩn đoán TOÀN DIỆN (sau xét nghiệm), kèm confidence score. `generate`
 * là no-op an toàn nếu mô-đun AI chưa được cấu hình (xem AiDiagnosisReviewService).
 *
 * Việc "Chấp nhận / Phủ quyết" 1 gợi ý cụ thể thuộc về bước kết luận chuyên môn — xem
 * diagnosis-conclusion (controller khác trong module này), không đặt ở đây, để controller này chỉ
 * làm đúng 1 việc: sinh & liệt kê gợi ý.
 */
@ApiTags('Post-Test Consultation - AI Diagnosis Review (Comprehensive)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('post-test-consultation/encounters/:encounterId/ai-diagnosis-review')
export class AiDiagnosisReviewController {
    constructor(private readonly aiDiagnosisReviewService: AiDiagnosisReviewService) {}

    @Post('generate')
    @ApiOperation({
        summary: 'Yêu cầu AI sinh (lại) top-k gợi ý chẩn đoán toàn diện cho 1 lượt khám, dựa trên cả kết quả xét nghiệm',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    generate(@Param('encounterId') encounterId: string) {
        return this.aiDiagnosisReviewService.generate(encounterId);
    }

    @Get()
    @ApiOperation({ summary: 'Xem top-k gợi ý chẩn đoán toàn diện do AI đề xuất (kèm confidence score)' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách gợi ý, sắp theo rank tăng dần. Rỗng nếu chưa sinh.' })
    listByEncounter(@Param('encounterId') encounterId: string) {
        return this.aiDiagnosisReviewService.listByEncounterId(encounterId);
    }
}
