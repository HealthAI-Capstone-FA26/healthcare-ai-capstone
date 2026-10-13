import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { ChiefComplaintService } from './chief-complaint.service';
import { UpsertChiefComplaintDto } from './dto/upsert-chief-complaint.dto';

@ApiTags('Chief Complaint')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('encounters/:encounterId/chief-complaint')
export class ChiefComplaintController {
  constructor(private readonly chiefComplaintService: ChiefComplaintService) {}

  @Post()
  @ApiOperation({ summary: 'Khai báo/cập nhật lý do khám & triệu chứng cho 1 lượt khám' })
  upsert(
    @Param('encounterId') encounterId: string,
    @Body() dto: UpsertChiefComplaintDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.chiefComplaintService.upsert(encounterId, dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Xem lý do khám & triệu chứng của 1 lượt khám' })
  findByEncounterId(@Param('encounterId') encounterId: string) {
    return this.chiefComplaintService.findByEncounterId(encounterId);
  }
}