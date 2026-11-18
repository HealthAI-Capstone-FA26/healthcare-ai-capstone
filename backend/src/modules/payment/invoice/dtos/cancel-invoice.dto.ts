import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelInvoiceDto {
  @ApiPropertyOptional({ example: 'Bệnh nhân đổi ý, không khám nữa' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  cancelReason?: string;
}
