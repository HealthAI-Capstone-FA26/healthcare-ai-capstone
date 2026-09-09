import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsISO8601, IsNotEmpty, IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * Module 8, mục "Tư vấn điều trị": bác sĩ ghi nhận thông tin tư vấn cho bệnh nhân sau khi đã có
 * kết luận chẩn đoán chính thức — giải thích tình trạng bệnh, phương án điều trị, và chế độ sinh
 * hoạt/dinh dưỡng phù hợp. Ánh xạ trực tiếp theo model TreatmentConsultation (1-1 với Encounter).
 */
export class UpsertTreatmentConsultationDto {
    @ApiPropertyOptional({ description: 'Giải thích tình trạng bệnh cho bệnh nhân' })
    @IsNotEmpty({ message: 'conditionExplanation không được để trống' })
    @IsString()
    conditionExplanation: string;

    @ApiPropertyOptional({ description: 'Phương án điều trị' })
    @IsNotEmpty({ message: 'treatmentPlan không được để trống' })
    @IsString()
    treatmentPlan: string;

    @ApiPropertyOptional({ description: 'Lời khuyên về chế độ sinh hoạt' })
    @IsOptional()
    @IsString()
    lifestyleAdvice?: string;

    @ApiPropertyOptional({ description: 'Lời khuyên về chế độ dinh dưỡng' })
    @IsOptional()
    @IsString()
    nutritionAdvice?: string;

    @ApiPropertyOptional({ description: 'Có cần tái khám hay không', default: false })
    @IsOptional()
    @IsBoolean()
    followUpRequired?: boolean;

    @ApiPropertyOptional({ description: 'Ngày hẹn tái khám (ISO 8601) — bắt buộc nếu followUpRequired = true' })
    @ValidateIf((dto: UpsertTreatmentConsultationDto) => dto.followUpRequired === true)
    @IsNotEmpty({ message: 'followUpDate không được để trống khi followUpRequired = true' })
    @IsISO8601()
    followUpDate?: string;

    @ApiPropertyOptional({ description: 'Thời điểm tư vấn (ISO 8601) — mặc định thời điểm gọi API' })
    @IsOptional()
    @IsISO8601()
    consultedAt?: string;
}
