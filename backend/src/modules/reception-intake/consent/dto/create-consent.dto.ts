import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export enum SignatureType {
  E_SIGNATURE_DRAW = 'e_signature_draw',
  OTP_CONFIRMED = 'otp_confirmed',
  CHECKBOX_CLICK = 'checkbox_click',
}

export class CreateConsentDto {
  @ApiProperty()
  @IsUUID()
  patientId: string;

  @ApiPropertyOptional({
    description: 'NULL khi ký ngoài ngữ cảnh 1 lượt khám cụ thể (vd: ký trước qua app khi đặt lịch online)',
  })
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiProperty()
  @IsUUID()
  policyId: string;

  @ApiProperty({ enum: SignatureType })
  @IsEnum(SignatureType)
  signatureType: SignatureType;

  @ApiPropertyOptional({ maxLength: 255, description: 'Ảnh/dữ liệu chữ ký lưu ở object storage, đây chỉ là đường dẫn' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  signatureDataUrl?: string;

  // true nếu ký tại quầy có lễ tân đứng làm chứng (witnessedByUserId sẽ lấy từ CurrentUser);
  // false/omit nếu bệnh nhân tự ký qua app -> witnessedByUserId = null. Không nhận thẳng
  // witnessedByUserId từ client để tránh giả mạo người làm chứng.
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  witnessedAtCounter?: boolean;
}