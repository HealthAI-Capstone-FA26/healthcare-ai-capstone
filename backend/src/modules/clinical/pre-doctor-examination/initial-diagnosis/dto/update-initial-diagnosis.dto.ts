import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/** Sửa chẩn đoán ban đầu đã ghi (đổi mã ICD-10 thì xoá rồi tạo lại). Chỉ các trường được liệt kê mới sửa được. */
export class UpdateInitialDiagnosisDto {
    @ApiPropertyOptional({ maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    diagnosisName?: string;

    @ApiPropertyOptional({ maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    notes?: string;

    @ApiPropertyOptional({ description: 'true = đặt làm chẩn đoán chính (hạ chẩn đoán chính cũ cùng loại). Không thể đặt false trực tiếp.' })
    @IsOptional()
    @IsBoolean()
    isPrimary?: boolean;
}
