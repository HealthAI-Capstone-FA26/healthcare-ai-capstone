import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TreatmentConsultationService } from './treatment-consultation.service';
import { UpsertTreatmentConsultationDto } from './dto/upsert-treatment-consultation.dto';

/**
 * SE05, "Tư vấn điều trị". Chỉ DOCTOR (assert trong service). PUT vì đây là upsert 1-1 theo encounterId (idempotent).
 */
@ApiTags('Post-Test Consultation - Treatment Consultation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('post-test-consultation/encounters/:encounterId/treatment-consultation')
export class TreatmentConsultationController {
    constructor(private readonly treatmentConsultationService: TreatmentConsultationService) {}

    @Put()
    @ApiOperation({
        summary: 'Ghi nhận (hoặc cập nhật) thông tin tư vấn điều trị cho 1 lượt khám',
        description:
            "Chỉ khi lượt khám đang 'awaiting_review' và đã có ít nhất 1 chẩn đoán chính thức (final). KHÔNG đổi " +
            "trạng thái lượt khám — kê đơn, hẹn tái khám và đóng lượt khám ('finished') thuộc bước SE06. " +
            'Tái khám chỉ lưu gợi ý followUpIntervalDays (số ngày).',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    upsert(
        @Param('encounterId') encounterId: string,
        @Body() dto: UpsertTreatmentConsultationDto,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.treatmentConsultationService.upsert(encounterId, dto, currentUserId);
    }

    @Get()
    @ApiOperation({ summary: 'Xem thông tin tư vấn điều trị của 1 lượt khám' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: 'Bản ghi TreatmentConsultation của lượt khám.' })
    findByEncounterId(@Param('encounterId') encounterId: string) {
        return this.treatmentConsultationService.findByEncounterId(encounterId);
    }
}
