import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Ghi nhận 1 chẩn đoán CHÍNH THỨC (SE05, "Kết luận chuyên môn"). Diagnosis.diagnosisType luôn là 'final' khi tạo qua
 * API này — đối lập với chẩn đoán ban đầu ('initial') / phân biệt ('differential') ở SE02.
 *
 * Bác sĩ tự kết luận sau khi xem kết quả cận lâm sàng — KHÔNG còn gợi ý AI / chấp nhận / phủ quyết (đã gỡ khỏi
 * phạm vi). AI duy nhất còn lại là cảnh báo bất thường ECG, bác sĩ xem và đánh giá ở phía lab-test.
 */
export class CreateDiagnosisConclusionDto {
    @ApiPropertyOptional({ description: 'Mã ICD-10 của chẩn đoán chính thức', example: 'I25.1' })
    @IsNotEmpty({ message: 'icd10Code không được để trống' })
    @IsString()
    icd10Code: string;

    @ApiPropertyOptional({ description: 'Tên chẩn đoán hiển thị — bỏ trống sẽ lấy theo tên chuẩn ICD-10', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    diagnosisName?: string;

    @ApiPropertyOptional({
        description:
            'Chẩn đoán chính (primary). Bỏ trống: chẩn đoán final ĐẦU TIÊN của lượt khám tự là primary. ' +
            'Đặt true sẽ hạ primary cũ. Mỗi lượt khám tối đa 1 chẩn đoán final primary.',
    })
    @IsOptional()
    @IsBoolean()
    isPrimary?: boolean;

    @ApiPropertyOptional({ maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    notes?: string;

    @ApiPropertyOptional({ description: 'Thời điểm ra kết luận (ISO 8601) — mặc định thời điểm gọi API' })
    @IsOptional()
    @IsISO8601()
    diagnosedAt?: string;
}
