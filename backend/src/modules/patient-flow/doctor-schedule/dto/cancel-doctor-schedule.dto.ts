import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelDoctorScheduleDto {
  @ApiPropertyOptional({ example: 'Bác sĩ đột xuất nghỉ ốm' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
