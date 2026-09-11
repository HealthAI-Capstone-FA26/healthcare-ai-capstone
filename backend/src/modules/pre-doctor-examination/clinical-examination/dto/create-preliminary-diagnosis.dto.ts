import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/**
 * Ghi nhận 1 chẩn đoán SƠ BỘ (Module 5, mục "Ghi nhận chẩn đoán"). Diagnosis.diagnosisType luôn
 * là 'preliminary' khi tạo qua API này — chẩn đoán CHÍNH THỨC (diagnosisType='final') chỉ được
 * tạo ở Module 8 (post-test-consultation) theo đúng nghiệp vụ "kết luận chuyên môn sau xét nghiệm".
 * Encounter có thể có nhiều chẩn đoán sơ bộ (1 chính + các chẩn đoán phân biệt/kèm theo).
 */
export class CreatePreliminaryDiagnosisDto {
    @ApiPropertyOptional({ description: 'Mã ICD-10 của chẩn đoán', example: 'J18.9' })
    @IsNotEmpty({ message: 'icd10Code không được để trống' })
    @IsString()
    icd10Code: string;

    @ApiPropertyOptional({ description: 'Tên chẩn đoán hiển thị — nếu bỏ trống sẽ lấy theo tên chuẩn ICD-10' })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    diagnosisName?: string;

    @ApiPropertyOptional({ description: 'Đây có phải chẩn đoán chính (primary) hay không', default: false })
    @IsOptional()
    @IsBoolean()
    isPrimary?: boolean;

    @ApiPropertyOptional({ maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    notes?: string;

    @ApiPropertyOptional({
        description: 'Nếu bác sĩ tham khảo 1 gợi ý AI cụ thể (AiDiagnosisSuggestion) khi ra chẩn đoán này',
        format: 'uuid',
    })
    @IsOptional()
    @IsUUID()
    aiSuggestionId?: string;

    @ApiPropertyOptional({ description: 'Thời điểm chẩn đoán (ISO 8601) — mặc định thời điểm gọi API' })
    @IsOptional()
    @IsISO8601()
    diagnosedAt?: string;
}
