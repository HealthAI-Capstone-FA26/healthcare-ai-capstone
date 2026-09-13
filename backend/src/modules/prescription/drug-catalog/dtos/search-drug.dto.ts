import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SearchDrugDto {
    @ApiPropertyOptional({ description: 'Tìm theo tên thuốc, tên gốc hoặc mã thuốc', example: 'amox' })
    @IsOptional()
    @IsString()
    query?: string;

    @ApiPropertyOptional({ description: 'Số trang, bắt đầu từ 1', default: 1, minimum: 1 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1;

    @ApiPropertyOptional({ description: 'Số bản ghi mỗi trang', default: 20, minimum: 1, maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number = 20;
}
