import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class FindExaminationFeesQueryDto {
  @ApiPropertyOptional({ example: 'standard', description: "'standard' | 'follow_up' | 'online_booking'" })
  @IsOptional()
  @IsString()
  feeType?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}
