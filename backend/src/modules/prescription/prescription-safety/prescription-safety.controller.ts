import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { PrescriptionSafetyService } from './prescription-safety.service';
import { ConfirmAlertDto } from './dtos/confirm-alert.dto';

@ApiTags('Prescription Safety')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('prescriptions')
export class PrescriptionSafetyController {
    constructor(private readonly prescriptionSafetyService: PrescriptionSafetyService) {}

    @Get(':id/alerts')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.READ}:${Scope.ALL}`)
    @ApiOperation({ summary: 'Danh sách cảnh báo an toàn (Safety Check) của đơn thuốc' })
    findAlerts(@Param('id') prescriptionId: string) {
        return this.prescriptionSafetyService.findAlertsByPrescription(prescriptionId);
    }

    @Patch(':id/alerts/:alertId/confirm')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.UPDATE}:${Scope.OWN}`)
    @ApiOperation({ summary: 'Bác sĩ xác nhận đã biết rủi ro của 1 cảnh báo an toàn (bắt buộc nêu lý do override)' })
    confirmAlert(
        @Param('id') prescriptionId: string,
        @Param('alertId') alertId: string,
        @Body() dto: ConfirmAlertDto,
        @CurrentUser() user: RequestUser,
    ) {
        return this.prescriptionSafetyService.confirmAlert(prescriptionId, alertId, dto, user.userId);
    }
}
