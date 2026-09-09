import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class FindDiagnosesQueryDto {
    @ApiPropertyOptional({ enum: ['preliminary', 'final'], description: 'Lọc theo loại chẩn đoán' })
    @IsOptional()
    @IsIn(['preliminary', 'final'])
    diagnosisType?: 'preliminary' | 'final';
}
