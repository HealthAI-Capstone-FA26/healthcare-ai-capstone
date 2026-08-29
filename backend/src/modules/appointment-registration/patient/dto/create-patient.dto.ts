import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export enum PatientGender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
  UNKNOWN = 'unknown',
}

// Không cho client tự set `userId`/`patientCode` qua DTO này — service tự quyết định
// dựa trên context gọi (lễ tân tạo hộ vs user tự tạo hồ sơ cho mình, xem patient.service.ts).
export class CreatePatientDto {
  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @MaxLength(255)
  fullName: string;

  @ApiProperty({ example: '1990-05-20' })
  @IsDateString()
  dateOfBirth: string;

  @ApiProperty({ enum: PatientGender, example: PatientGender.MALE })
  @IsEnum(PatientGender)
  gender: PatientGender;

  @ApiPropertyOptional({ example: '079090001234' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  identityNumber?: string;

  @ApiPropertyOptional({ example: 'HS4010123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  insuranceNumber?: string;

  @ApiProperty({ example: '0901234567' })
  @IsString()
  @MaxLength(20)
  phoneNumber: string;

  @ApiPropertyOptional({ example: 'a@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ example: '123 Lê Lợi, Q1, TP.HCM' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ example: 'Con cái' })
  @IsOptional()
  @IsString()
  relationship?: string;

  @ApiPropertyOptional({ example: 'Kinh' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  ethnicity?: string;
}
