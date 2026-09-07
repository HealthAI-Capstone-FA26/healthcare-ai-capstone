import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class FindPatientAllergyQueryDto {
  @ApiPropertyOptional({ description: 'active | resolved | entered_in_error' })
  @IsOptional()
  @IsString()
  status?: string;
}
