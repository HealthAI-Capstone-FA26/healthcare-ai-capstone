import { IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ReferenceRangeQueryDto {
    @ApiPropertyOptional({
        description: 'Thời điểm tính tuổi để tra ngưỡng (ISO 8601). Mặc định là thời điểm gọi API.',
        example: '2026-09-05T08:30:00.000Z',
    })
    @IsOptional()
    @IsDateString()
    measuredAt?: string;
}
