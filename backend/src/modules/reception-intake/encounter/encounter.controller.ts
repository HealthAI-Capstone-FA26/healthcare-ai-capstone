import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { EncounterService } from './encounter.service';
import { FindEncountersQueryDto } from './dto/find-encounter-query.dto';
import { UpdateEncounterDepartmentDto } from './dto/update-encounter-department.dto';
import { EncounterDepartmentRoutingService } from './encounter-department-routing.service';

@ApiTags('Encounter')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard)
@Controller('encounters')
export class EncounterController {
  constructor(
    private readonly encounterService: EncounterService,
    private readonly encounterDepartmentRoutingService: EncounterDepartmentRoutingService,
  ) { }

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

  @Patch(':id/department')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Đổi khoa cho bệnh nhân sau khi đã đo sinh hiệu, tự chọn bác sĩ đang trong ca có ít bệnh nhân chờ nhất và xếp vào hàng đợi',
    description:
      'Chỉ NURSE / RECEPTIONIST / ADMIN. Lượt khám phải đang registered hoặc waiting_for_doctor và đã có ít nhất 1 ' +
      'phiên sinh hiệu và CHƯA có DoctorQueueEntry (đã vào hàng đợi bác sĩ thì không đổi được). Bác sĩ được chọn theo số DoctorQueueEntry (waiting/called/in_progress) trong ngày ít nhất; ' +
      'hoà thì chọn ngẫu nhiên đều. Không có bác sĩ nào đang trong ca -> 400 và không thay đổi gì.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  changeDepartment(
    @Param('id') id: string,
    @Body() dto: UpdateEncounterDepartmentDto,
    @CurrentUser('userId') currentUserId: string,
  ): Promise<any> {
    return this.encounterDepartmentRoutingService.changeDepartment(id, dto, currentUserId);
  }
}
