import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { InitialDiagnosisSuggestionService } from './initial-diagnosis-suggestion.service';

/**
 * API cho khung AI gợi ý chẩn đoán sơ bộ (trước xét nghiệm), kèm confidence score. `generate` là
 * no-op an toàn nếu mô-đun AI chưa được cấu hình (xem InitialDiagnosisSuggestionService).
 */
@ApiTags('Doctor Examination - AI Diagnosis Suggestion (Initial)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('doctor-examination/encounters/:encounterId/ai-diagnosis-suggestions')
export class InitialDiagnosisSuggestionController {
    constructor(private readonly initialDiagnosisSuggestionService: InitialDiagnosisSuggestionService) {}

    @Post('generate')
    @ApiOperation({ summary: 'Yêu cầu AI sinh (lại) top-k gợi ý chẩn đoán sơ bộ cho 1 lượt khám' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    generate(@Param('encounterId') encounterId: string) {
        return this.initialDiagnosisSuggestionService.generate(encounterId);
    }

    @Get()
    @ApiOperation({ summary: 'Xem top-k gợi ý chẩn đoán sơ bộ do AI đề xuất (kèm confidence score)' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách gợi ý, sắp theo rank tăng dần. Rỗng nếu chưa sinh.' })
    listByEncounter(@Param('encounterId') encounterId: string) {
        return this.initialDiagnosisSuggestionService.listByEncounterId(encounterId);
    }
}
