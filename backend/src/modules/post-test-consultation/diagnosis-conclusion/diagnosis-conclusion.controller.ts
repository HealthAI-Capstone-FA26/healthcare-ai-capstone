import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { DiagnosisConclusionService } from './diagnosis-conclusion.service';
import { CreateDiagnosisConclusionDto } from './dto/create-diagnosis-conclusion.dto';
import { RejectAiSuggestionDto } from './dto/reject-ai-suggestion.dto';
import { FindFinalDiagnosesQueryDto } from './dto/find-final-diagnoses-query.dto';

/**
 * Module 8, mục "Kết luận chuyên môn (Bác sĩ)". Chỉ DOCTOR (assert trong service) mới được ghi;
 * danh sách trả về ở GET mặc định CHỈ gồm chẩn đoán 'final' (khác Module 5 — xem
 * FindFinalDiagnosesQueryDto), vì Diagnosis là 1 bảng dùng chung theo toàn vòng đời lượt khám.
 */
@ApiTags('Post-Test Consultation - Diagnosis Conclusion')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('post-test-consultation/encounters/:encounterId/diagnosis-conclusion')
export class DiagnosisConclusionController {
    constructor(private readonly diagnosisConclusionService: DiagnosisConclusionService) {}

    @Post()
    @ApiOperation({
        summary: 'Ghi nhận 1 chẩn đoán chính thức (diagnosisType=final) cho lượt khám',
        description:
            'Yêu cầu lượt khám đã có ít nhất 1 kết quả xét nghiệm được chốt (final/corrected). Có thể ' +
            'kèm aiSuggestionId + aiDecision để ghi lại việc bác sĩ đã Chấp nhận/Phủ quyết/Điều chỉnh ' +
            'so với gợi ý AI toàn diện tương ứng.',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    create(
        @Param('encounterId') encounterId: string,
        @Body() dto: CreateDiagnosisConclusionDto,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.diagnosisConclusionService.create(encounterId, dto, currentUserId);
    }

    @Post('ai-suggestions/:suggestionId/reject')
    @ApiOperation({
        summary: 'Phủ quyết 1 gợi ý chẩn đoán AI (comprehensive_review) mà không kèm tạo chẩn đoán chính thức',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiParam({ name: 'suggestionId', format: 'uuid' })
    rejectAiSuggestion(
        @Param('encounterId') encounterId: string,
        @Param('suggestionId') suggestionId: string,
        @Body() dto: RejectAiSuggestionDto,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.diagnosisConclusionService.rejectAiSuggestion(encounterId, suggestionId, dto, currentUserId);
    }

    @Get()
    @ApiOperation({ summary: "Danh sách chẩn đoán của 1 lượt khám — mặc định chỉ chẩn đoán 'final'" })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách chẩn đoán, mới nhất trước.' })
    findByEncounterId(@Param('encounterId') encounterId: string, @Query() query: FindFinalDiagnosesQueryDto) {
        return this.diagnosisConclusionService.findByEncounterId(encounterId, query);
    }
}
