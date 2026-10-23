import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Max, Min, ValidateIf } from 'class-validator';

/**
 * SE05, "Tư vấn điều trị": bác sĩ ghi nhận thông tin tư vấn cho bệnh nhân sau khi đã có chẩn đoán chính thức — giải
 * thích tình trạng bệnh, phương án điều trị, chế độ sinh hoạt/dinh dưỡng. Ánh xạ model TreatmentConsultation (1-1
 * với Encounter).
 *
 * Tái khám: chỉ lưu GỢI Ý khoảng cách (`followUpIntervalDays`). Lịch hẹn thật là Appointment(appointmentType =
 * 'follow_up', sourceEncounterId) do SE06 tạo — không còn `followUpDate` ở đây.
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

    @ApiPropertyOptional({
        description:
            'Gợi ý số ngày tới lần tái khám (1–730) — BẮT BUỘC khi followUpRequired = true. ' +
            'Bị bỏ qua (lưu null) khi followUpRequired = false.',
        minimum: 1,
        maximum: 730,
    })
    @ValidateIf((dto: UpsertTreatmentConsultationDto) => dto.followUpRequired === true)
    @IsNotEmpty({ message: 'followUpIntervalDays không được để trống khi followUpRequired = true' })
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(730)
    followUpIntervalDays?: number;

    @ApiPropertyOptional({ description: 'Thời điểm tư vấn (ISO 8601) — mặc định thời điểm gọi API' })
    @IsOptional()
    @IsISO8601()
    consultedAt?: string;
}
