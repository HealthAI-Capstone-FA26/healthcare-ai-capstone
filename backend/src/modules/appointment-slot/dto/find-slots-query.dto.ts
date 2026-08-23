import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class FindSlotsQueryDto {
  @ApiProperty({ example: '2026-09-01' })
  @IsDateString()
  date: string;
}
