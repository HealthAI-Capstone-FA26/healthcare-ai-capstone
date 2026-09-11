import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { PreliminaryDiagnosisService } from './preliminary-diagnosis.service';
import { CreatePreliminaryDiagnosisDto } from './dto/create-preliminary-diagnosis.dto';
import { FindDiagnosesQueryDto } from './dto/find-diagnoses-query.dto';

/**
 * Module 5, mục "Ghi nhận chẩn đoán" (phần chẩn đoán sơ bộ). Danh sách trả về ở GET bao gồm cả
 * chẩn đoán 'final' được tạo sau này ở Module 8 (nếu có) trừ khi lọc theo diagnosisType, vì
 * Diagnosis là 1 bảng dùng chung theo toàn vòng đời lượt khám.
 */
@ApiTags('Doctor Examination - Preliminary Diagnosis')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('doctor-examination/encounters/:encounterId/diagnoses')
export class PreliminaryDiagnosisController {
    constructor(private readonly preliminaryDiagnosisService: PreliminaryDiagnosisService) {}

    @Post()
    @ApiOperation({ summary: 'Ghi nhận 1 chẩn đoán sơ bộ (diagnosisType=preliminary) cho lượt khám' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    create(
        @Param('encounterId') encounterId: string,
        @Body() dto: CreatePreliminaryDiagnosisDto,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.preliminaryDiagnosisService.create(encounterId, dto, currentUserId);
    }

    @Get()
    @ApiOperation({ summary: 'Danh sách chẩn đoán của 1 lượt khám (mặc định gồm cả sơ bộ & chính thức)' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách chẩn đoán, mới nhất trước.' })
    findByEncounterId(@Param('encounterId') encounterId: string, @Query() query: FindDiagnosesQueryDto) {
        return this.preliminaryDiagnosisService.findByEncounterId(encounterId, query);
    }
}
