import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../../../common/constants/permissions.dictionary';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../identity-access/auth/strategies/jwt.strategy';
import { AppointmentService } from './appointment.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { FindAppointmentsQueryDto } from './dto/find-appointments-query.dto';
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { SyncPatientDto } from './dto/sync-patient.dto';

@ApiTags('Appointment')
@ApiBearerAuth()
@Controller('appointments')
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) { }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiOperation({ summary: 'Đặt lịch online qua 1 slot còn trống' })
  create(@Body() dto: CreateAppointmentDto, @CurrentUser() user: RequestUser) {
    return this.appointmentService.createOnline(dto, user);
  }

  @Get()
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiOperation({ summary: 'Danh sách lịch hẹn, lọc theo patientId/status/khoảng ngày' })
  findMany(@Query() query: FindAppointmentsQueryDto, @CurrentUser() user: RequestUser) {
    return this.appointmentService.findMany(query, user);
  }

  @Post('sync-patient')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  // @RequirePermissions(`${Resource.APPOINTMENT}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({
    summary:
      'Lễ tân đối chiếu CCCD/CMND tại quầy cho case "matched" (appointment có suggestedPatientId, patientId=null)',
  })
  syncPatient(@Body() dto: SyncPatientDto) {
    return this.appointmentService.syncPatient(dto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiOperation({ summary: 'Xem chi tiết 1 lịch hẹn' })
  findOne(@Param('id') id: string) {
    return this.appointmentService.findById(id);
  }

  // Nhóm transition thuộc quầy lễ tân: appointment:update:all
  @Patch(':id/confirm')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(`${Resource.APPOINTMENT}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Reception xác nhận lịch hẹn (pending -> confirmed)' })
  confirm(@Param('id') id: string) {
    return this.appointmentService.confirm(id);
  }

  @Patch(':id/check-in')
  @RequirePermissions(`${Resource.APPOINTMENT}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({
    summary: 'Bệnh nhân đặt lịch online đã có mặt tại bệnh viện — phát số thứ tự (prefix A, ưu tiên hơn at_hospital)',
  })
  checkIn(@Param('id') id: string) {
    return this.appointmentService.checkIn(id);
  }

  @Patch(':id/no-show')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(`${Resource.APPOINTMENT}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Đánh dấu bệnh nhân không đến (-> no_show)' })
  markNoShow(@Param('id') id: string) {
    return this.appointmentService.markNoShow(id);
  }

  // Nhóm transition thuộc bác sĩ khi khám: appointment:update:own (chỉ trên lịch hẹn của chính mình)
  @Patch(':id/start')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  // @RequirePermissions(`${Resource.APPOINTMENT}:${Action.UPDATE}:${Scope.OWN}`)
  @ApiOperation({ summary: 'Bác sĩ bắt đầu khám (checked_in -> in_progress)' })
  start(@Param('id') id: string) {
    return this.appointmentService.start(id);
  }

  @Patch(':id/complete')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermissions(`${Resource.APPOINTMENT}:${Action.UPDATE}:${Scope.OWN}`)
  @ApiOperation({ summary: 'Bác sĩ hoàn tất khám (in_progress -> completed)' })
  complete(@Param('id') id: string) {
    return this.appointmentService.complete(id);
  }

  @Patch(':id/cancel')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  // @RequirePermissions(`${Resource.APPOINTMENT}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Huỷ lịch hẹn (chỉ cho phép từ pending/confirmed)' })
  cancel(
    @Param('id') id: string,
    @Body() dto: CancelAppointmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.appointmentService.cancel(id, dto, user);
  }

  @Patch(':id/reschedule')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @ApiOperation({ summary: 'Bệnh nhân đổi ngày/giờ tái khám (chọn slot mới hoặc nhập ngày khác)' })
  reschedule(
    @Param('id') id: string,
    @Body() dto: RescheduleAppointmentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.appointmentService.rescheduleFollowUp(id, dto, user);
  }
}
