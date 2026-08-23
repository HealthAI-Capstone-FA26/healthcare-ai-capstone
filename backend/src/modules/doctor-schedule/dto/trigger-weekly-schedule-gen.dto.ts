import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional } from 'class-validator';

export class TriggerWeeklyScheduleGenDto {
  @ApiPropertyOptional({
    example: '2026-08-24',
    description: 'Thứ 2 của tuần cần sinh lịch (YYYY-MM-DD). Bỏ trống để dùng tuần kế tiếp.',
  })
  @IsOptional()
  @IsDateString()
  weekMonday?: string;
}
