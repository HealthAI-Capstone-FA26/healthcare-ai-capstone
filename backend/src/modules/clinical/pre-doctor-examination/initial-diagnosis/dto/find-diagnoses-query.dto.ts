import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class FindDiagnosesQueryDto {
    @ApiPropertyOptional({ enum: ['initial', 'differential', 'final'], description: 'Lọc theo loại chẩn đoán' })
    @IsOptional()
    @IsIn(['initial', 'differential', 'final'])
    diagnosisType?: 'initial' | 'differential' | 'final';
}
