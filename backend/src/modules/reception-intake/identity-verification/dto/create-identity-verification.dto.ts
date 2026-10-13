import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

export enum VerificationMethod {
  NATIONAL_ID_CARD = 'national_id_card',
  HEALTH_INSURANCE_CARD = 'health_insurance_card',
  PATIENT_CARD = 'patient_card',
  PHONE_OTP = 'phone_otp',
  MANUAL = 'manual',
}

export enum VerificationStatus {
  VERIFIED = 'verified',
  FAILED = 'failed',
  PENDING = 'pending',
}

export class CreateIdentityVerificationDto {
  @ApiProperty({ enum: VerificationMethod })
  @IsEnum(VerificationMethod)
  verificationMethod: VerificationMethod;

  @ApiProperty({ enum: VerificationStatus })
  @IsEnum(VerificationStatus)
  verificationStatus: VerificationStatus;

  // Bắt buộc phải giải thích lý do khi verify thất bại (đối chiếu không khớp), để ReceptionStaff
  // sau xem log biết vì sao — validate ở đây thay vì chỉ optional chung chung.
  @ApiPropertyOptional({ maxLength: 255 })
  @ValidateIf((dto: CreateIdentityVerificationDto) => dto.verificationStatus === VerificationStatus.FAILED)
  @IsString()
  @MaxLength(255)
  mismatchNotes?: string;
}