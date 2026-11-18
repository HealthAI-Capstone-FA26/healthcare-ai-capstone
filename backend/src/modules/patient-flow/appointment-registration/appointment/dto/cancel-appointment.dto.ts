import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelAppointmentDto {
  @ApiPropertyOptional({ example: 'Bệnh nhân bận việc đột xuất' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  cancelReason?: string;
}
