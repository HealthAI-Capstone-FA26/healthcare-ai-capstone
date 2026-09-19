import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsNumber, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreateExaminationFeeDto {
  @ApiProperty({ example: 'Khám tổng quát' })
  @IsString()
  @MaxLength(100)
  feeName: string;

  @ApiPropertyOptional({ example: 'standard', description: "'standard' | 'urgent' | ... — VarChar tự do" })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  feeType?: string;

  @ApiProperty({ example: 150000 })
  @IsNumber()
  @IsPositive()
  price: number;

  @ApiPropertyOptional({ example: '2026-09-09', description: 'Ngày mức phí bắt đầu có hiệu lực' })
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
