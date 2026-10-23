import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

export enum MedicalHistoryStatus {
  ACTIVE = 'active',
  RESOLVED = 'resolved',
  INACTIVE = 'inactive',
}

// Chỉ cho sửa status — không có giới hạn ghi đè, chỉ thêm dòng mới hoặc đổi status
// (đúng nguyên tắc module3.md mục 5): conditionName/icd10Code/... không được sửa qua DTO này.
export class UpdatePatientMedicalHistoryStatusDto {
  @ApiProperty({ enum: MedicalHistoryStatus })
  @IsEnum(MedicalHistoryStatus)
  status: MedicalHistoryStatus;
}
