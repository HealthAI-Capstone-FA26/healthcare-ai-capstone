import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength, Min } from 'class-validator';

export class PrescriptionItemDto {
    @ApiProperty({ description: 'ID thuốc trong DrugCatalog', format: 'uuid' })
    @IsUUID()
    drugId: string;

    @ApiProperty({ description: 'Số lượng kê', example: 20 })
    @IsNumber()
    @IsPositive()
    quantity: number;

    @ApiProperty({ description: 'Liều dùng, ví dụ "1 viên/lần"', example: '1 viên/lần' })
    @IsString()
    @MaxLength(100)
    dosage: string;

    @ApiPropertyOptional({ description: 'Mã đường dùng (theo hệ mã chuẩn nếu có)' })
    @IsOptional()
    @IsString()
    @MaxLength(30)
    routeCode?: string;

    @ApiPropertyOptional({ description: 'Tên hiển thị đường dùng, ví dụ "Uống"' })
    @IsOptional()
    @IsString()
    @MaxLength(100)
    routeDisplay?: string;

    @ApiProperty({ description: 'Tần suất dùng, ví dụ "2 lần/ngày"', example: '2 lần/ngày' })
    @IsString()
    @MaxLength(50)
    frequency: string;

    @ApiPropertyOptional({ description: 'Số ngày dùng thuốc' })
    @IsOptional()
    @IsInt()
    @Min(1)
    durationDays?: number;

    @ApiPropertyOptional({ description: 'Lời dặn thêm cho bệnh nhân' })
    @IsOptional()
    @IsString()
    instruction?: string;
}
