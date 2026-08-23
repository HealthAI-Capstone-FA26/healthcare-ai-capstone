import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { FindSlotsQueryDto } from './dto/find-slots-query.dto';
import { AppointmentSlotService } from './appointment-slot.service';

// Route nằm dưới tài nguyên "doctors" (không phải "doctor-schedules") theo đúng path spec Phase 3.
@ApiTags('Appointment-slot')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard)
@Controller('doctors')
export class AppointmentSlotController {
  constructor(private readonly appointmentSlotService: AppointmentSlotService) {}

  @Get(':id/slots')
  @ApiOperation({ summary: 'Liệt kê slot còn trống (status=free) của 1 bác sĩ theo ngày — bước chọn slot khi đặt lịch' })
  findFreeSlots(@Param('id') doctorId: string, @Query() query: FindSlotsQueryDto) {
    return this.appointmentSlotService.findFreeSlotsByDoctorAndDate(doctorId, query.date);
  }
}
