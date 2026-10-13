import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ActorRolesGuard } from '../../../common/guards/actor-roles.guard';
import { AllowActorRoles } from '../../../common/decorators/actor-roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { ClinicalExaminationService } from './clinical-examination.service';
import { UpsertClinicalExaminationDto } from './dto/upsert-clinical-examination.dto';

/**
 * SE02 — Phiếu thăm khám lâm sàng tim mạch (tư thế → nhìn → sờ → gõ → nghe → nhận định).
 */
@ApiTags('Doctor Examination - Clinical Examination')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ActorRolesGuard)
@AllowActorRoles(ACTOR_ROLE.DOCTOR, ACTOR_ROLE.NURSE, ACTOR_ROLE.ADMIN)
@Controller('doctor-examination/encounters/:encounterId')
export class ClinicalExaminationController {
    constructor(private readonly clinicalExaminationService: ClinicalExaminationService) {}

    @Post('start')
    @AllowActorRoles(ACTOR_ROLE.DOCTOR)
    @ApiOperation({
        summary: 'Bác sĩ bắt đầu khám (waiting_for_doctor → in_progress)',
        description:
            'Idempotent. Đồng bộ DoctorQueueEntry (in_progress + examStartedAt) và gán Encounter.doctorId nếu còn trống. ' +
            'Có thể bỏ qua: lưu phiếu khám / chẩn đoán lần đầu cũng tự bắt đầu khám.',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: '{ encounterId, status, doctorId, started } — started=false nếu đã bắt đầu từ trước.' })
    start(@Param('encounterId', ParseUUIDPipe) encounterId: string, @CurrentUser('userId') currentUserId: string) {
        return this.clinicalExaminationService.startExamination(encounterId, currentUserId);
    }

    @Post('clinical-examination')
    @AllowActorRoles(ACTOR_ROLE.DOCTOR)
    @ApiOperation({
        summary: 'Ghi nhận (hoặc cập nhật / lưu nháp) phiếu thăm khám lâm sàng cho 1 lượt khám',
        description:
            "Chỉ bác sĩ phụ trách lượt khám. Gửi `structured` theo checkbox của phiếu (nhìn/sờ/gõ/nghe/nhận định) và/hoặc " +
            "ghi chú tự do. Mục gửi lên ghi đè nguyên mục, mục không gửi giữ nguyên. Lượt khám 'waiting_for_doctor' " +
            "sẽ tự chuyển 'in_progress'.",
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    upsert(
        @Param('encounterId', ParseUUIDPipe) encounterId: string,
        @Body() dto: UpsertClinicalExaminationDto,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.clinicalExaminationService.upsert(encounterId, dto, currentUserId);
    }

    @Get('clinical-examination')
    @ApiOperation({
        summary: 'Xem phiếu thăm khám lâm sàng đã ghi nhận cho 1 lượt khám',
        description: '404 nếu chưa ghi nhận. Để dựng sẵn form nên gọi GET .../overview (trả clinicalExamination = null khi chưa có).',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    findByEncounterId(@Param('encounterId', ParseUUIDPipe) encounterId: string) {
        return this.clinicalExaminationService.findByEncounterId(encounterId);
    }
}
