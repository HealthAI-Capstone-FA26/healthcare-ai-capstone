import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class FindConsentsQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional({ description: 'active | revoked' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'data_processing | treatment_consent | telehealth_consent' })
  @IsOptional()
  @IsString()
  policyType?: string;
}