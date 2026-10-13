import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class ListInvoicesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  appointmentId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  patientId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  encounterId?: string;

  @ApiPropertyOptional({ example: 'pending', description: "'pending' | 'paid' | 'cancelled' | 'refunded'" })
  @IsOptional()
  @IsString()
  status?: string;
}
