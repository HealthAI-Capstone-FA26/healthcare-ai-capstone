import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export enum AllergyStatus {
  ACTIVE = 'active',
  RESOLVED = 'resolved',
  ENTERED_IN_ERROR = 'entered_in_error',
}

// Chỉ cho sửa status — không có giới hạn ghi đè, chỉ thêm dòng mới hoặc đổi status
// (đúng nguyên tắc module3.md mục 5): allergenName/severity/... không được sửa qua DTO này.
export class UpdatePatientAllergyStatusDto {
  @ApiProperty({ enum: AllergyStatus })
  @IsEnum(AllergyStatus)
  status: AllergyStatus;
}
