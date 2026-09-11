import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Ghi nhận kết quả thăm khám lâm sàng (Module 5, mục "Ghi nhận chẩn đoán"). Mỗi lượt khám
 * (Encounter) chỉ có DUY NHẤT 1 bản ghi ClinicalExamination — gọi lại API này sẽ cập nhật
 * (upsert), tương tự cách ChiefComplaint được xử lý ở module reception-intake.
 */
export class UpsertClinicalExaminationDto {
    @ApiPropertyOptional({ description: 'Kết quả thăm khám lâm sàng (triệu chứng thực thể, nghe/nhìn/sờ/gõ...)' })
    @IsNotEmpty({ message: 'examinationFindings không được để trống' })
    @IsString()
    examinationFindings: string;

    @ApiPropertyOptional({ description: 'Ghi chú lâm sàng thêm của bác sĩ' })
    @IsOptional()
    @IsString()
    clinicalNotes?: string;

    @ApiPropertyOptional({ description: 'Thời điểm khám (ISO 8601) — mặc định thời điểm gọi API' })
    @IsOptional()
    @IsISO8601()
    examinedAt?: string;
}
