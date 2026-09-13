import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AiClinicalSummaryService } from './ai-clinical-summary.service';

/**
 * API cho khung AI tóm tắt lâm sàng. Nội dung phân tích thật sẽ được đổ vào khi mô-đun AI được
 * triển khai (xem AiClinicalSummaryService) — hiện tại `generate` là no-op an toàn nếu chưa có provider.
 */
@ApiTags('Doctor Examination - AI Clinical Summary')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('doctor-examination/encounters/:encounterId/ai-clinical-summary')
export class AiClinicalSummaryController {
    constructor(private readonly aiClinicalSummaryService: AiClinicalSummaryService) {}

    @Post('generate')
    @ApiOperation({
        summary: 'Yêu cầu (sinh lại) bản tóm tắt lâm sàng do AI tạo cho 1 lượt khám',
        description: 'No-op an toàn nếu mô-đun AI chưa được cấu hình (khung chờ tích hợp).',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    async generate(@Param('encounterId') encounterId: string) {
        await this.aiClinicalSummaryService.generate(encounterId);
        return { encounterId, status: 'requested' };
    }

    @Get()
    @ApiOperation({ summary: 'Xem bản tóm tắt lâm sàng do AI tạo (kèm nguồn tham chiếu), nếu đã có' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: 'Bản tóm tắt AI, hoặc null nếu chưa được sinh.' })
    async getByEncounter(@Param('encounterId') encounterId: string) {
        return this.aiClinicalSummaryService.getByEncounterId(encounterId);
    }
}
