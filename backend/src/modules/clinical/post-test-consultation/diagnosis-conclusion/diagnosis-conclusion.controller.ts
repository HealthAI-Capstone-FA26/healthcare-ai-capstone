import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBadRequestResponse, ApiConflictResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { DiagnosisConclusionService } from './diagnosis-conclusion.service';
import { CreateDiagnosisConclusionDto } from './dto/create-diagnosis-conclusion.dto';
import { FindFinalDiagnosesQueryDto } from './dto/find-final-diagnoses-query.dto';

/**
 * SE05, "Kết luận chuyên môn (Bác sĩ)". Chỉ DOCTOR được ghi (assert trong service); GET mặc định CHỈ gồm chẩn đoán
 * 'final' (khác SE02 — xem FindFinalDiagnosesQueryDto), vì Diagnosis là bảng dùng chung toàn vòng đời lượt khám.
 */
@ApiTags('Post-Test Consultation - Diagnosis Conclusion')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('post-test-consultation/encounters/:encounterId/diagnosis-conclusion')
export class DiagnosisConclusionController {
    constructor(private readonly diagnosisConclusionService: DiagnosisConclusionService) { }

    @Post()
    @ApiOperation({
        summary: 'Ghi nhận 1 chẩn đoán chính thức (diagnosisType=final) cho lượt khám',
        description:
            "Chỉ khi lượt khám đang 'awaiting_review' (mọi cận lâm sàng đã hoàn tất). Chẩn đoán final đầu tiên tự là " +
            'primary nếu không chỉ định; đặt isPrimary=true sẽ hạ primary cũ. Không cho trùng mã ICD-10 trong cùng lượt khám.',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiBadRequestResponse({ description: "Lượt khám chưa 'awaiting_review', hoặc mã ICD-10 không hợp lệ/ngưng dùng." })
    @ApiConflictResponse({ description: 'Đã có chẩn đoán chính thức cùng mã ICD-10.' })
    create(
        @Param('encounterId') encounterId: string,
        @Body() dto: CreateDiagnosisConclusionDto,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.diagnosisConclusionService.create(encounterId, dto, currentUserId);
    }

    @Get()
    @ApiOperation({ summary: "Danh sách chẩn đoán của 1 lượt khám — mặc định chỉ chẩn đoán 'final'" })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách chẩn đoán, mới nhất trước.' })
    findByEncounterId(@Param('encounterId') encounterId: string, @Query() query: FindFinalDiagnosesQueryDto) {
        return this.diagnosisConclusionService.findByEncounterId(encounterId, query);
    }
}
