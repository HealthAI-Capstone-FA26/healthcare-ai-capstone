import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { PrescriptionFollowupService } from './prescription-followup.service';
import { ScheduleFollowupDto } from './dtos/schedule-followup.dto';

@ApiTags('Prescription Followup')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('prescriptions')
export class PrescriptionFollowupController {
    constructor(private readonly prescriptionFollowupService: PrescriptionFollowupService) {}

    @Post(':id/followup')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.UPDATE}:${Scope.OWN}`)
    @ApiOperation({
        summary: 'Đặt lịch tái khám tại viện theo đơn thuốc đã ký',
        description:
            'Chỉ cho phép khi đơn thuốc status=signed và do chính bác sĩ đang đăng nhập kê. ' +
            'Tạo Appointment + QueueTicket kiểu "tái khám tại viện" qua AppointmentService.createAtHospital ' +
            '(walk-in hôm nay, không đặt được ngày tương lai cụ thể — xem note trong ScheduleFollowupDto), ' +
            'sau đó gửi email nhắc lịch cho bệnh nhân.',
    })
    scheduleFollowup(
        @Param('id') prescriptionId: string,
        @Body() dto: ScheduleFollowupDto,
        @CurrentUser() user: RequestUser,
    ) {
        return this.prescriptionFollowupService.scheduleFollowup(prescriptionId, dto, user);
    }
}
