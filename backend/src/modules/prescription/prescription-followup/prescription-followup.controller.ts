import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
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
        summary: 'Đặt lịch tái khám (Appointment) theo đơn thuốc đã ký',
        description:
            'Chỉ cho phép khi đơn thuốc status=signed và do chính bác sĩ đang phụ trách kê. ' +
            'Tạo Appointment kiểu "follow_up" (booking_channel=doctor_follow_up), liên kết với sourceEncounterId. ' +
            'Tự động đóng lượt khám (status=finished) nếu closeEncounter=true, và lập lịch thông báo nhắc tái khám.',
    })
    scheduleFollowup(
        @Param('id') prescriptionId: string,
        @Body() dto: ScheduleFollowupDto,
        @CurrentUser() user: RequestUser,
    ) {
        return this.prescriptionFollowupService.scheduleFollowup(prescriptionId, dto, user);
    }

    @Get(':id/followup/suggestion')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.READ}:${Scope.ALL}`)
    @ApiOperation({
        summary: 'Gợi ý ngày tái khám (theo phác đồ / thời gian dùng thuốc). Bác sĩ vẫn có thể chọn ngày khác.',
    })
    getSuggestion(@Param('id') prescriptionId: string) {
        return this.prescriptionFollowupService.getSuggestedDate(prescriptionId);
    }

    @Get(':id/followup')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.READ}:${Scope.ALL}`)
    @ApiOperation({
        summary: 'Xem chi tiết lịch hẹn tái khám liên kết với đơn thuốc',
    })
    getFollowup(@Param('id') prescriptionId: string) {
        return this.prescriptionFollowupService.getFollowup(prescriptionId);
    }

    @Post('encounters/:encounterId/finish')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.UPDATE}:${Scope.OWN}`)
    @ApiOperation({
        summary: 'Đóng lượt khám (status=finished) khi hoàn tất kê đơn không cần đặt lịch tái khám',
    })
    finishEncounter(@Param('encounterId') encounterId: string, @CurrentUser() user: RequestUser) {
        return this.prescriptionFollowupService.finishEncounter(encounterId, user);
    }
}
