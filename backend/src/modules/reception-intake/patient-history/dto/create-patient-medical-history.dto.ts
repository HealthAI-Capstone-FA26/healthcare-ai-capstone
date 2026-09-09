import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export enum MedicalHistoryType {
  CHRONIC_DISEASE = 'chronic_disease',
  SURGERY = 'surgery',
  FAMILY_HISTORY = 'family_history',
}

export class CreatePatientMedicalHistoryDto {
  @ApiProperty({ enum: MedicalHistoryType })
  @IsEnum(MedicalHistoryType)
  historyType: MedicalHistoryType;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  conditionName: string;

  // Chưa validate tồn tại ở tầng DTO vì bảng ICD10_CODES thuộc Module 5 mới có đủ dữ liệu —
  // service sẽ tự kiểm tra tồn tại trước khi insert (schema thật đã có FK tới icd10_codes,
  // khác với ghi chú "chỉ lưu string tạm" trong tài liệu gốc — xem comment trong service).
  @ApiPropertyOptional({ maxLength: 10 })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  icd10Code?: string;

  @ApiPropertyOptional({ example: '2020-05-01' })
  @IsOptional()
  @IsDateString()
  onsetDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  // Ghi hồ sơ dài hạn cho bệnh nhân, không gắn cứng vào 1 lượt khám — chỉ audit lượt khám nào
  // khai báo, nên optional (đúng ghi chú module3.md mục 5).
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  encounterId?: string;
}
