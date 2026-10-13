import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class FindConsentPoliciesQueryDto {
  @ApiPropertyOptional({ description: 'data_processing | treatment_consent | telehealth_consent' })
  @IsOptional()
  @IsString()
  policyType?: string;
}