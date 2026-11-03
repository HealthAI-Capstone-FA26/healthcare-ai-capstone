import { Module } from '@nestjs/common';
import { UserModule } from '../../identity-access/user/user.module';
import { PkiController } from './pki.controller';
import { PkiKeyVaultService } from './pki-key-vault.service';
import { PkiAuthorityService } from './pki-authority.service';
import { DoctorCertificateService } from './doctor-certificate.service';
import { PdfSignatureService } from './pdf-signature.service';

/**
 * PKI / CA cho chữ ký số đơn thuốc: Root CA nội bộ, cấp/thu hồi/import chứng thư bác sĩ, ký và xác minh PDF (PAdES).
 * PrismaModule là @Global nên không cần import lại.
 */
@Module({
    imports: [UserModule], // ActorRolesGuard cần ActorRoleService
    controllers: [PkiController],
    providers: [PkiKeyVaultService, PkiAuthorityService, DoctorCertificateService, PdfSignatureService],
    exports: [DoctorCertificateService, PdfSignatureService, PkiAuthorityService],
})
export class PkiModule {}
