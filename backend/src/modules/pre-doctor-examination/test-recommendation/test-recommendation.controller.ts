import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { TestRecommendationService } from './test-recommendation.service';

@ApiTags('Doctor Examination - Test Recommendation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('doctor-examination')
export class TestRecommendationController {
    constructor(private readonly testRecommendationService: TestRecommendationService) {}

    @Get('icd10/:icd10Code/test-recommendations')
    @ApiOperation({ summary: 'Danh mục xét nghiệm được gợi ý theo mã ICD-10 (ưu tiên "recommended" trước)' })
    @ApiParam({ name: 'icd10Code', example: 'J18.9' })
    @ApiOkResponse({ description: 'Danh sách gợi ý, kèm thông tin danh mục xét nghiệm (TestCatalog).' })
    byIcd10Code(@Param('icd10Code') icd10Code: string) {
        return this.testRecommendationService.byIcd10Code(icd10Code);
    }

    @Get('diagnoses/:diagnosisId/test-recommendations')
    @ApiOperation({ summary: 'Danh mục xét nghiệm được gợi ý dựa trên 1 chẩn đoán đã ghi nhận' })
    @ApiParam({ name: 'diagnosisId', format: 'uuid' })
    byDiagnosisId(@Param('diagnosisId') diagnosisId: string) {
        return this.testRecommendationService.byDiagnosisId(diagnosisId);
    }
}
