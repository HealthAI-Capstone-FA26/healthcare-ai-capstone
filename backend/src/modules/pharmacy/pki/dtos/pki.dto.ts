import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RevokeCertificateDto {
    @ApiProperty({ description: 'Lý do thu hồi (lộ khoá, bác sĩ nghỉ việc, sai thông tin, ...)', example: 'Nghi ngờ lộ private key' })
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    reason: string;
}

export class TrustAuthorityDto {
    @ApiProperty({ description: 'Chứng thư Root/Intermediate CA dạng PEM (-----BEGIN CERTIFICATE-----)' })
    @IsString()
    @IsNotEmpty()
    certPem: string;
}

export class ImportPkcs12Dto {
    @ApiProperty({ description: 'Mật khẩu của file .p12/.pfx' })
    @IsString()
    @IsNotEmpty()
    passphrase: string;
}
