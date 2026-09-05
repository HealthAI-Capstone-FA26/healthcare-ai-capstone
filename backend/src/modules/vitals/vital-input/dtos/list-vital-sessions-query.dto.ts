import { IsUUID, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ListVitalSessionsQueryDto {
    @ApiProperty({ description: 'ID lượt khám cần xem lịch sử ghi nhận sinh hiệu', format: 'uuid' })
    @IsUUID()
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
