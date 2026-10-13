import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ActorRolesGuard } from '../../../common/guards/actor-roles.guard';
import { AllowActorRoles } from '../../../common/decorators/actor-roles.decorator';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { CaseOverviewService } from './case-overview.service';

/**
 * SE02 — bác sĩ xem hồ sơ bệnh nhân trước/trong lúc khám: lý do khám, sinh hiệu vừa ghi (kèm cờ bất thường),
 * dị ứng, tiền sử, khám lâm sàng, chẩn đoán ban đầu và chỉ định cận lâm sàng.
 */
@ApiTags('Doctor Examination - Case Overview')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ActorRolesGuard)
@AllowActorRoles(ACTOR_ROLE.DOCTOR, ACTOR_ROLE.NURSE, ACTOR_ROLE.ADMIN)
@Controller('doctor-examination/encounters/:encounterId')
export class CaseOverviewController {
    constructor(private readonly caseOverviewService: CaseOverviewService) {}

    @Get('overview')
    @ApiOperation({
        summary: 'Tổng hợp hồ sơ bệnh án điện tử cho 1 lượt khám',
        description:
            'Gồm: thông tin cá nhân, lý do khám/triệu chứng, sinh hiệu mới nhất kèm cảnh báo bất thường đang active, ' +
            'dị ứng, tiền sử bệnh, kết quả khám lâm sàng, chẩn đoán ban đầu và các chỉ định cận lâm sàng (kèm trạng thái task).',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: 'Toàn bộ dữ liệu tổng hợp cho 1 lượt khám.' })
    getOverview(@Param('encounterId', ParseUUIDPipe) encounterId: string) {
        return this.caseOverviewService.getOverview(encounterId);
    }
}
