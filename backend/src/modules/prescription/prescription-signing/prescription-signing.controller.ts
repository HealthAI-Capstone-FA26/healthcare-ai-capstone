import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { PrescriptionSigningService } from './prescription-signing.service';
import { SignPrescriptionDto } from './dtos/sign-prescription.dto';

@ApiTags('Prescription Signing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('prescriptions')
export class PrescriptionSigningController {
    constructor(private readonly prescriptionSigningService: PrescriptionSigningService) {}

    @Post(':id/sign')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.UPDATE}:${Scope.OWN}`)
    @ApiOperation({
        summary: 'Ký số đơn thuốc (giả lập bằng xác thực lại mật khẩu bác sĩ)',
        description:
            'Chặn ký nếu còn PrescriptionSafetyAlert severity severe/contraindicated ở trạng thái active chưa confirm. ' +
            'Khi hợp lệ: chuyển status draft -> signed, sinh certificateSerial giả lập và xuất PDF chính thức.',
    })
    sign(@Param('id') id: string, @Body() dto: SignPrescriptionDto, @CurrentUser() user: RequestUser) {
        return this.prescriptionSigningService.sign(id, dto, user);
    }

    @Get(':id/export')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.READ}:${Scope.ALL}`)
    @ApiOperation({
        summary: 'Xuất PDF đơn thuốc',
        description:
            'Nếu đơn đã ký (status=signed): trả lại URL file PDF chính thức đã lưu. ' +
            'Nếu còn draft: sinh bản xem trước (preview), không set pdfFileUrl lên Prescription.',
    })
    export(@Param('id') id: string) {
        return this.prescriptionSigningService.export(id);
    }
}
