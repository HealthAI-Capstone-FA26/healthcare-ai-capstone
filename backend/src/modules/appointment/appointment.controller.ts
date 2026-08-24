import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../common/constants/permissions.dictionary';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/strategies/jwt.strategy';
import { AppointmentService } from './appointment.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { CreateAtHospitalAppointmentDto } from './dto/create-at-hospital-appointment.dto';
import { FindAppointmentsQueryDto } from './dto/find-appointments-query.dto';
import { UpdateAppointmentStatusDto } from './dto/update-appointment-status.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';

@ApiTags('Appointment')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('appointments')
export class AppointmentController {
  constructor(private readonly appointmentService: AppointmentService) {}

  @Post()
  @ApiOperation({ summary: 'Đặt lịch online (cho mình hoặc người thân) qua 1 slot còn trống' })
  create(@Body() dto: CreateAppointmentDto, @CurrentUser() user: RequestUser) {
    return this.appointmentService.createOnline(dto, user);
  }

  @Post('at-hospital')
  // @RequirePermissions(`${Resource.APPOINTMENT}:${Action.CREATE}:${Scope.ALL}`)
  @ApiOperation({
    summary: 'Lễ tân tạo lịch tại quầy (bookingChannel = at_hospital), luôn kèm 1 QueueTicket prefix B',
  })
  createAtHospital(@Body() dto: CreateAtHospitalAppointmentDto, @CurrentUser() user: RequestUser) {
    return this.appointmentService.createAtHospital(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách lịch hẹn, lọc theo patientId/status/khoảng ngày' })
  findMany(@Query() query: FindAppointmentsQueryDto) {
    return this.appointmentService.findMany(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Xem chi tiết 1 lịch hẹn' })
  findOne(@Param('id') id: string) {
    return this.appointmentService.findById(id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cập nhật trạng thái lịch hẹn theo state machine dùng chung' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdateAppointmentStatusDto) {
    return this.appointmentService.updateStatus(id, dto);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Huỷ lịch hẹn (chỉ cho phép từ pending/confirmed)' })
  cancel(@Param('id') id: string, @Body() dto: CancelAppointmentDto) {
    return this.appointmentService.cancel(id, dto);
  }
}
