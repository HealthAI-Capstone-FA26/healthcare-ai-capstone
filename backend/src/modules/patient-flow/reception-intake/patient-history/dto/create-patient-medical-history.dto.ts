import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum MedicalHistoryType {
  CHRONIC_DISEASE = 'chronic_disease',
  SURGERY = 'surgery',
  FAMILY_HISTORY = 'family_history',
  CARDIAC_PROCEDURE = 'cardiac_procedure',
  RISK_FACTOR = 'risk_factor',
}

export class CreatePatientMedicalHistoryDto {
  @ApiProperty({ enum: MedicalHistoryType })
  @IsEnum(MedicalHistoryType)
  historyType: MedicalHistoryType;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  conditionName: string;

  @ApiPropertyOptional({ example: '2020-05-01' })
  @IsOptional()
  @IsDateString()
  onsetDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
