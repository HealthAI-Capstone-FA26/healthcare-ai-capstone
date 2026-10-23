import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class FindPatientMedicalHistoryQueryDto {
  @ApiPropertyOptional({ description: 'chronic_disease | surgery | family_history' })
  @IsOptional()
  @IsString()
  historyType?: string;
}
