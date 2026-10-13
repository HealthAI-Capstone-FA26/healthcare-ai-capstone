import { IsOptional, IsInt, IsString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListVitalSessionsQueryDto {
    @ApiProperty({ description: 'ID lượt khám (encounterId hoặc encounterCode) cần xem lịch sử' })
    @IsString()
    encounterId: string;

    @ApiPropertyOptional({
        description: 'Số lượng lần đo tối đa trả về, mới nhất trước',
        default: 20,
        minimum: 1,
        maximum: 100,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}
