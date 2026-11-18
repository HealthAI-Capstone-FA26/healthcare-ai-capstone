import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DoctorScheduleService } from './doctor-schedule.service';
import { CreateDoctorScheduleDto } from './dto/create-doctor-schedule.dto';
import { SearchDoctorScheduleDto } from './dto/search-doctor-schedule.dto';
import { CancelDoctorScheduleDto } from './dto/cancel-doctor-schedule.dto';
import { TriggerWeeklyScheduleGenDto } from './dto/trigger-weekly-schedule-gen.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { WeeklyScheduleGenCron } from '../../../common/cron/weekly-schedule-gen.cron';

@ApiTags('Doctor Schedules')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('doctor-schedules')
export class DoctorScheduleController {
  constructor(
    private readonly doctorScheduleService: DoctorScheduleService,
    private readonly weeklyScheduleGenCron: WeeklyScheduleGenCron,
  ) {}

  @Post()
  @RequirePermissions(`${Resource.DOCTOR_SCHEDULE}:${Action.CREATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Tạo lịch làm việc thủ công cho bác sĩ (ngoài cron), tự sinh slot' })
  create(@Body() dto: CreateDoctorScheduleDto) {
    return this.doctorScheduleService.create(dto);
  }

  @Get()
  // @RequirePermissions(`${Resource.DOCTOR_SCHEDULE}:${Action.READ}:${Scope.OWN}`)
  @ApiOperation({ summary: 'Danh sách lịch làm việc theo bác sĩ / khoảng ngày' })
  findAll(@Query() query: SearchDoctorScheduleDto) {
    return this.doctorScheduleService.findAll(query);
  }

  @Get(':id')
  // @RequirePermissions(`${Resource.DOCTOR_SCHEDULE}:${Action.READ}:${Scope.OWN}`)
  @ApiOperation({ summary: 'Xem chi tiết 1 lịch làm việc kèm slot' })
  findOne(@Param('id') id: string) {
    return this.doctorScheduleService.findById(id);
  }

  @Patch(':id/cancel')
  @RequirePermissions(`${Resource.DOCTOR_SCHEDULE}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({
    summary:
      'Báo nghỉ: huỷ lịch, chuyển slot free -> blocked; slot đã có appointment giữ nguyên (xử lý riêng)',
  })
  cancel(@Param('id') id: string, @Body() dto: CancelDoctorScheduleDto) {
    return this.doctorScheduleService.cancel(id, dto.reason);
  }

  @Post('cron/weekly-generate')
  @RequirePermissions(`${Resource.DOCTOR_SCHEDULE}:${Action.CREATE}:${Scope.ALL}`)
  @ApiOperation({
    summary: 'Trigger sinh lịch tuần và slot thủ công (không cần tạo từng ca qua API create)',
  })
  triggerWeeklyGenerate(@Body() dto: TriggerWeeklyScheduleGenDto) {
    const weekMonday = dto.weekMonday
      ? new Date(`${dto.weekMonday}T00:00:00.000Z`)
      : undefined;
    return this.weeklyScheduleGenCron.triggerWeeklyGeneration(weekMonday);
  }
}
