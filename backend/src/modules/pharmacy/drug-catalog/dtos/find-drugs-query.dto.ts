import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * Tham số tìm kiếm / lọc danh mục thuốc (DrugCatalog) phục vụ màn hình kê đơn (Prescription).
 */
export class FindDrugsQueryDto {
    @ApiPropertyOptional({
        description: 'Từ khoá tìm theo mã thuốc, mã danh mục quốc gia, tên thuốc hoặc hoạt chất (genericName)',
        example: 'bisoprolol',
    })
    @IsOptional()
    @IsString()
    search?: string;

    @ApiPropertyOptional({
        description: 'Lọc theo nhóm điều trị (therapeuticClass), VD: beta_blocker, ace_inhibitor, statin',
        example: 'beta_blocker',
    })
    @IsOptional()
    @IsString()
    therapeuticClass?: string;

    @ApiPropertyOptional({
        description: 'Lọc theo đường dùng (route), VD: oral, iv',
        example: 'oral',
    })
    @IsOptional()
    @IsString()
    route?: string;

    @ApiPropertyOptional({
        description: 'Lọc theo ID nhóm dị ứng / danh mục thuốc (allergenCategoryId)',
        format: 'uuid',
    })
    @IsOptional()
    @IsUUID()
    allergenCategoryId?: string;

    @ApiPropertyOptional({
        description: "Chỉ lấy thuốc đang lưu hành — mặc định 'true'. Truyền 'false' để lấy thuốc đã ngừng lưu hành.",
        default: 'true',
    })
    @IsOptional()
    @IsBooleanString()
    isActive?: string;

    @ApiPropertyOptional({
        description: 'Số bản ghi tối đa trả về (bỏ trống sẽ trả về toàn bộ)',
        minimum: 1,
    })
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit?: number;
}
