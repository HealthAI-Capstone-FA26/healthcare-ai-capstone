import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { EncounterService } from './encounter.service';
import { FindEncountersQueryDto } from './dto/find-encounter-query.dto';

@ApiTags('Encounter')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard)
@Controller('encounters')
export class EncounterController {
  constructor(private readonly encounterService: EncounterService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách lượt khám theo bệnh nhân/trạng thái, sắp xếp mới nhất trước' })
  findMany(@Query() query: FindEncountersQueryDto) {
    return this.encounterService.findMany(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Chi tiết 1 lượt khám kèm lý do khám, lịch sử xác minh danh tính, hàng chờ bác sĩ, đồng ý',
  })
  findById(@Param('id') id: string) {
    return this.encounterService.findById(id);
  }

  @Post(':id/complete-registration')
  @ApiOperation({
    summary:
      'Hoàn tất thủ tục tiếp đón: kiểm tra đủ chief complaint + xác minh danh tính + consent bắt buộc, chuyển Encounter sang registered và xếp vào hàng đợi triage cho module vitals',
  })
  completeRegistration(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.encounterService.completeRegistration(id, user);
  }
}