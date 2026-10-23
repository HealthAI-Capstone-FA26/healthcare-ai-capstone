import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export const INITIAL_DIAGNOSIS_TYPES = ['initial', 'differential'] as const;
export type InitialDiagnosisType = (typeof INITIAL_DIAGNOSIS_TYPES)[number];

/**
 * Ghi nhận chẩn đoán BAN ĐẦU (SE02). Diagnosis.diagnosisType = 'initial' (chẩn đoán chính/ban đầu) hoặc
 * 'differential' (chẩn đoán phân biệt). Chẩn đoán CHÍNH THỨC ('final') chỉ tạo ở SE05 (post-test-consultation).
 * Chỉ định cận lâm sàng bắt buộc tham chiếu 1 chẩn đoán 'initial' của lượt khám.
 */
export class CreateInitialDiagnosisDto {
    @ApiPropertyOptional({ description: 'Mã ICD-10 của chẩn đoán', example: 'I20.9' })
    @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
    @IsNotEmpty({ message: 'icd10Code không được để trống' })
    @IsString()
    @MaxLength(10)
    icd10Code: string;

    @ApiPropertyOptional({ description: 'Tên chẩn đoán hiển thị — bỏ trống sẽ lấy theo tên chuẩn ICD-10', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    diagnosisName?: string;

    @ApiPropertyOptional({ enum: INITIAL_DIAGNOSIS_TYPES, default: 'initial' })
    @IsOptional()
    @IsIn(INITIAL_DIAGNOSIS_TYPES)
    diagnosisType?: InitialDiagnosisType;

    @ApiPropertyOptional({
        description:
            'Chẩn đoán chính. Mỗi lượt khám tối đa 1 chẩn đoán chính cho mỗi loại. Bỏ trống: tự đặt là chính nếu ' +
            'đây là chẩn đoán đầu tiên của loại đó, ngược lại là phụ.',
    })
    @IsOptional()
    @IsBoolean()
    isPrimary?: boolean;

    @ApiPropertyOptional({ maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    notes?: string;

    @ApiPropertyOptional({ description: 'Thời điểm chẩn đoán (ISO 8601) — mặc định thời điểm gọi API' })
    @IsOptional()
    @IsISO8601()
    diagnosedAt?: string;
}
