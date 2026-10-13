import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ActorRolesGuard } from '../../../common/guards/actor-roles.guard';
import { AllowActorRoles } from '../../../common/decorators/actor-roles.decorator';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { ServiceLookupService } from './service-lookup.service';
import { FindServicesQueryDto } from './dto/find-services-query.dto';

@ApiTags('Doctor Examination - Service Lookup')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ActorRolesGuard)
@AllowActorRoles(ACTOR_ROLE.DOCTOR, ACTOR_ROLE.NURSE, ACTOR_ROLE.ADMIN)
@Controller('doctor-examination/services')
export class ServiceLookupController {
    constructor(private readonly serviceLookupService: ServiceLookupService) {}

    @Get()
    @ApiOperation({
        summary: 'Danh mục dịch vụ cận lâm sàng đang cung cấp (xét nghiệm máu / ECG / X-quang / siêu âm tim)',
        description: 'Dùng cho bác sĩ chọn dịch vụ khi chỉ định. Kèm phòng thực hiện mặc định, giá, yêu cầu nhịn ăn.',
    })
    @ApiOkResponse({ description: '{ total, items, groups } — groups nhóm theo modality + panelGroup.' })
    find(@Query() query: FindServicesQueryDto) {
        return this.serviceLookupService.find(query);
    }
}
