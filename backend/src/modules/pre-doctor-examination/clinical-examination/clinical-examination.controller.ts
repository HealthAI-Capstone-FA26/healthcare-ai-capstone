import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ClinicalExaminationService } from './clinical-examination.service';
import { UpsertClinicalExaminationDto } from './dto/upsert-clinical-examination.dto';

/**
 * Module 5, mục "Ghi nhận chẩn đoán" (phần khám lâm sàng).
 */
@ApiTags('Doctor Examination - Clinical Examination')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('doctor-examination/encounters/:encounterId/clinical-examination')
export class ClinicalExaminationController {
    constructor(private readonly clinicalExaminationService: ClinicalExaminationService) {}

    @Post()
    @ApiOperation({
        summary: 'Ghi nhận (hoặc cập nhật) kết quả thăm khám lâm sàng cho 1 lượt khám',
        description:
            "Chỉ bác sĩ (actorRole DOCTOR) được thực hiện. Nếu lượt khám đang 'waiting_for_doctor' " +
            "sẽ tự động chuyển sang 'in_progress'.",
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    upsert(
        @Param('encounterId') encounterId: string,
        @Body() dto: UpsertClinicalExaminationDto,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.clinicalExaminationService.upsert(encounterId, dto, currentUserId);
    }

    @Get()
    @ApiOperation({ summary: 'Xem kết quả thăm khám lâm sàng đã ghi nhận cho 1 lượt khám' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    findByEncounterId(@Param('encounterId') encounterId: string) {
        return this.clinicalExaminationService.findByEncounterId(encounterId);
    }
}
