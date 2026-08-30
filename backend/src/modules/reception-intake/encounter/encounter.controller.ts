import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { EncounterService } from './encounter.service';
import { FindEncountersQueryDto } from './dto/find-encounter-query.dto';

@ApiTags('Encounter')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
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
}