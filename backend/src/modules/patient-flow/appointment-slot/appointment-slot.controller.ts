import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FindSlotsQueryDto } from './dto/find-slots-query.dto';
import { AppointmentSlotService } from './appointment-slot.service';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';

// Route nằm dưới tài nguyên "doctors" (không phải "doctor-schedules") theo đúng path spec Phase 3.
@ApiTags('Appointment-slot')
<<<<<<< HEAD
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
=======
>>>>>>> 2d6c87fc7d528d0f2bf5b294f0b4e75faf211d4d
@Controller('doctors')
export class AppointmentSlotController {
  constructor(private readonly appointmentSlotService: AppointmentSlotService) { }

  @Get(':id/slots')
<<<<<<< HEAD
  @RequirePermissions(`${Resource.APPOINTMENT_SLOT}:${Action.READ}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Liệt kê slot còn trống (status=free) của 1 bác sĩ theo ngày — bước chọn slot khi đặt lịch' })
=======
  @ApiOperation({ summary: 'Liệt kê slot còn trống (status=free) của 1 bác sĩ theo ngày (Public API — phục vụ cả khách & bệnh nhân đặt lịch)' })
>>>>>>> 2d6c87fc7d528d0f2bf5b294f0b4e75faf211d4d
  findFreeSlots(@Param('id') doctorId: string, @Query() query: FindSlotsQueryDto) {
    return this.appointmentSlotService.findFreeSlotsByDoctorAndDate(doctorId, query.date);
  }
}
