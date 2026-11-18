import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BadRequestException } from '@nestjs/common';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ActorRolesGuard } from '../../../common/guards/actor-roles.guard';
import { AllowActorRoles } from '../../../common/decorators/actor-roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { RequestUser } from '../../identity-access/auth/strategies/jwt.strategy';
import { DoctorCertificateService, toPublicCertificate } from './doctor-certificate.service';
import { PkiAuthorityService } from './pki-authority.service';
import { ImportPkcs12Dto, RevokeCertificateDto, TrustAuthorityDto } from './dtos/pki.dto';

/**
 * Quản trị PKI / CA cho chữ ký số đơn thuốc. Mặc định chỉ ADMIN; riêng ca-certificate / crl mở cho mọi user đã đăng nhập
 * (cần để bên nhận đơn đối soát chữ ký).
 */
@ApiTags('PKI / Digital Certificates')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ActorRolesGuard)
@AllowActorRoles(ACTOR_ROLE.ADMIN)
@Controller('pki')
export class PkiController {
    constructor(
        private readonly certificates: DoctorCertificateService,
        private readonly authorities: PkiAuthorityService,
    ) {}

    @Get('ca-certificate')
    @AllowActorRoles()
    @ApiOperation({ summary: 'Chứng thư công khai của Root CA nội bộ (PEM) — để cài làm tin cậy khi mở PDF đơn thuốc' })
    caCertificate() {
        return this.authorities.getRootCaPublic();
    }

    @Get('crl')
    @AllowActorRoles()
    @ApiOperation({ summary: 'Danh sách chứng thư đã thu hồi (CRL dạng JSON)' })
    crl() {
        return this.certificates.revocationList();
    }

    @Get('authorities')
    @ApiOperation({ summary: 'Danh sách CA tin cậy (Root nội bộ + CA ngoài)' })
    listAuthorities() {
        return this.authorities.listAuthorities();
    }

    @Post('authorities/trust')
    @ApiOperation({
        summary: 'Thêm Root/Intermediate CA bên ngoài vào danh sách tin cậy',
        description: 'Cần làm trước khi import .p12 từ CA công cộng được cấp phép (VNPT-CA, Viettel-CA, FPT-CA, ...).',
    })
    trust(@Body() dto: TrustAuthorityDto) {
        return this.authorities.addTrustedExternal(dto.certPem);
    }

    @Get('certificates')
    @ApiQuery({ name: 'doctorId', required: false })
    @ApiOperation({ summary: 'Danh sách chứng thư số (không trả private key)' })
    list(@Query('doctorId') doctorId?: string) {
        return this.certificates.list(doctorId);
    }

    @Post('doctors/:doctorId/certificates')
    @ApiOperation({ summary: 'Cấp chứng thư số cho bác sĩ từ CA nội bộ (RSA-2048, ký SHA-256)' })
    async issue(@Param('doctorId', ParseUUIDPipe) doctorId: string, @CurrentUser() user: RequestUser) {
        return toPublicCertificate(await this.certificates.issueForDoctor(doctorId, user.userId));
    }

    @Post('doctors/:doctorId/certificates/import')
    @ApiConsumes('multipart/form-data')
    @ApiBody({
        schema: {
            type: 'object',
            required: ['file', 'passphrase'],
            properties: { file: { type: 'string', format: 'binary', description: '.p12 / .pfx' }, passphrase: { type: 'string' } },
        },
    })
    @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 1024 * 1024 } }))
    @ApiOperation({
        summary: 'Import chứng thư + private key (.p12) do CA công cộng được cấp phép phát hành',
        description: 'Chuỗi chứng thư phải xác minh được tới một CA đã thêm vào danh sách tin cậy.',
    })
    async importP12(
        @Param('doctorId', ParseUUIDPipe) doctorId: string,
        @UploadedFile() file: Express.Multer.File,
        @Body() dto: ImportPkcs12Dto,
        @CurrentUser() user: RequestUser,
    ) {
        if (!file?.buffer?.length) throw new BadRequestException('Thiếu file .p12');
        return toPublicCertificate(await this.certificates.importPkcs12(doctorId, file.buffer, dto.passphrase, user.userId));
    }

    @Post('certificates/:certificateId/revoke')
    @ApiOperation({ summary: 'Thu hồi chứng thư số' })
    revoke(@Param('certificateId', ParseUUIDPipe) certificateId: string, @Body() dto: RevokeCertificateDto, @CurrentUser() user: RequestUser) {
        return this.certificates.revoke(certificateId, dto.reason, user.userId);
    }
}
