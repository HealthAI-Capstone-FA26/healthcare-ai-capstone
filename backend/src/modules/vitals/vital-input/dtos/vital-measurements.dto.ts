import { IsOptional, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Các trường đo lường dùng chung cho cả "ghi nhận mới" (RecordVitalSignsDto) và
 * "sửa/bổ sung" (UpdateVitalSignsDto) — tránh lặp lại validation ở 2 nơi.
 */
export class VitalMeasurementsDto {
    @ApiPropertyOptional({ description: 'Mạch (lần/phút)', example: 82, minimum: 0, maximum: 300 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @Max(300)
    pulse?: number;

    @ApiPropertyOptional({ description: 'Huyết áp tâm thu (mmHg)', example: 120, minimum: 0, maximum: 300 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @Max(300)
    systolicBp?: number;

    @ApiPropertyOptional({ description: 'Huyết áp tâm trương (mmHg)', example: 80, minimum: 0, maximum: 300 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @Max(300)
    diastolicBp?: number;

    @ApiPropertyOptional({ description: 'Nhiệt độ (°C)', example: 37, minimum: 20, maximum: 45 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(20)
    @Max(45)
    temperature?: number;

    @ApiPropertyOptional({ description: 'Nhịp thở (lần/phút)', example: 18, minimum: 0, maximum: 120 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @Max(120)
    respiratoryRate?: number;

    @ApiPropertyOptional({ description: 'SpO2 (%)', example: 98, minimum: 0, maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @Max(100)
    spo2?: number;

    @ApiPropertyOptional({ description: 'Chiều cao (cm)', example: 165, minimum: 0, maximum: 300 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @Max(300)
    height?: number;

    @ApiPropertyOptional({ description: 'Cân nặng (kg)', example: 58, minimum: 0, maximum: 500 })
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @Max(500)
    weight?: number;
}
