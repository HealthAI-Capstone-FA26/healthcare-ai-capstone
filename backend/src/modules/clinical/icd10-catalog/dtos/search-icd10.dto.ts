import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/**
 * Tìm kiếm danh mục ICD-10 — dùng khi bác sĩ chọn mã bệnh cho chẩn đoán (Module 5 & Module 8).
 * `search` khớp theo mã hoặc tên (VI/EN), không phân biệt hoa thường (xem Icd10CatalogService).
 */
export class SearchIcd10Dto {
    @ApiPropertyOptional({ description: 'Từ khoá tìm theo mã ICD-10 hoặc tên bệnh (VI/EN)', example: 'viêm phổi' })
    @IsOptional()
    @IsString()
    search?: string;

    @ApiPropertyOptional({ description: 'Lọc theo chương bệnh ICD-10 (chapter)' })
    @IsOptional()
    @IsString()
    chapter?: string;

    @ApiPropertyOptional({
        description: "Chỉ lấy mã đang active — mặc định 'true'. Truyền 'false' để bao gồm cả mã đã ngưng dùng.",
        default: 'true',
    })
    @IsOptional()
    @IsBooleanString()
    isActive?: string;

    @ApiPropertyOptional({ description: 'Số bản ghi tối đa trả về', default: 20, minimum: 1, maximum: 100 })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(100)
    limit?: number;
}