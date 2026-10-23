import {
  IsString,
  IsOptional,
  IsUrl,
  IsObject,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class UpdateProfileDto {
  @ApiPropertyOptional({
    type: 'string',
    format: 'binary',
    description: 'File ảnh avatar upload trực tiếp',
  })
  @IsOptional()
  avatar?: any;

  @ApiPropertyOptional({
    example: 'doctor',
    description: 'Vai trò của user',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  actorRole?: string;

  @ApiPropertyOptional({
    example: 'Nguyen Van A',
    description: 'Họ và tên',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fullName?: string;

  @ApiPropertyOptional({
    example: '0901234567',
    description: 'Số điện thoại',
    maxLength: 20,
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.jpg',
    description: 'URL avatar (Dùng khi không upload file trực tiếp)',
    maxLength: 255,
  })
  @IsOptional()
  @IsUrl()
  @MaxLength(255)
  avatarUrl?: string;

  @ApiPropertyOptional({
    example: '{}',
    description: 'Thông tin profile bổ sung',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    }
    return value;
  })
  @IsObject()
  additionalProfile?: Record<string, any>;

  @ApiPropertyOptional({
    // example: 'Patient/123456',
    // description: 'FHIR Resource ID',
    // maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  fhirResourceId?: string;
}