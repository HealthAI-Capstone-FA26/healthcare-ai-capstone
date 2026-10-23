import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { Action, Resource, Scope } from '../../../../common/constants/permissions.dictionary';
import { RequestUser } from '../../../identity-access/auth/strategies/jwt.strategy';
import { PrescriptionSigningService } from './prescription-signing.service';
import { SignPrescriptionDto } from './dtos/sign-prescription.dto';

@ApiTags('Prescription Signing')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('prescriptions')
export class PrescriptionSigningController {
    constructor(private readonly prescriptionSigningService: PrescriptionSigningService) { }

    @Post(':id/sign')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.UPDATE}:${Scope.OWN}`)
    @ApiOperation({
        summary: 'Ký số đơn thuốc bằng chứng thư X.509 của bác sĩ (PKI, PAdES)',
        description:
            'Xác thực lại mật khẩu bác sĩ, chặn ký nếu còn PrescriptionSafetyAlert severity severe/contraindicated chưa confirm. ' +
            'Khi hợp lệ: dùng chứng thư số còn hiệu lực của bác sĩ (do CA nội bộ cấp hoặc import từ CA ngoài; chưa có thì tự cấp nếu ' +
            'PKI_AUTO_ISSUE bật), nhúng chữ ký PAdES vào PDF, chuyển status draft -> signed, ghi serial chứng thư + SHA-256 của file đã ký.',
    })
    sign(@Param('id') id: string, @Body() dto: SignPrescriptionDto, @CurrentUser() user: RequestUser) {
        return this.prescriptionSigningService.sign(id, dto, user);
    }

    @Get(':id/verify-signature')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.READ}:${Scope.ALL}`)
    @ApiOperation({
        summary: 'Xác minh chữ ký số của đơn thuốc đã ký',
        description:
            'Kiểm tra: chữ ký phủ toàn bộ file, mã băm nội dung, chữ ký RSA, chuỗi chứng thư tới CA tin cậy tại thời điểm ký, ' +
            'quyền ký (keyUsage), tình trạng thu hồi so với thời điểm ký, khớp mã băm/chứng thư lưu trong DB, người ký = bác sĩ kê đơn. ' +
            'Trả `valid` và danh sách `checks` chi tiết.',
    })
    verifySignature(@Param('id') id: string) {
        return this.prescriptionSigningService.verifySignature(id);
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
