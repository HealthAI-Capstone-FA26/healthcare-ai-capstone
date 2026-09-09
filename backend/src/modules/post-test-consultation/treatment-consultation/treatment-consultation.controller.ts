import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TreatmentConsultationService } from './treatment-consultation.service';
import { UpsertTreatmentConsultationDto } from './dto/upsert-treatment-consultation.dto';

/**
 * Module 8, mục "Tư vấn điều trị". Chỉ DOCTOR (assert trong service). PUT vì đây là thao tác
 * upsert 1-1 theo encounterId (idempotent), cùng quy ước với
 * doctor-examination/.../clinical-examination (Module 5) — dù controller đó lỡ dùng POST, ở đây
 * dùng đúng PUT theo semantics HTTP cho upsert.
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
            "Yêu cầu lượt khám đã có ít nhất 1 chẩn đoán chính thức (diagnosisType='final'). Lần tạo " +
            "đầu tiên sẽ tự động chuyển trạng thái lượt khám sang 'finished'.",
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
