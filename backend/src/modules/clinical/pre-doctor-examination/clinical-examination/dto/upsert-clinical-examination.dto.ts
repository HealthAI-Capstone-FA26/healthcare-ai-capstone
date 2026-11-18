import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsISO8601, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { StructuredExaminationDto } from './structured-examination.dto';

/**
 * Ghi nhận phiếu thăm khám lâm sàng tim mạch: tư thế -> nhìn -> sờ -> gõ -> nghe -> nhận định.
 * Mỗi Encounter chỉ có DUY NHẤT 1 ClinicalExamination — gọi lại API là upsert (lưu nháp từng phần được).
 *
 * Hai cách nhập (có thể dùng song song):
 *  - `structured`: dữ liệu theo đúng checkbox/radio của phiếu (khuyến nghị cho frontend) — backend tự sinh
 *    văn bản tiếng Việt vào các cột text để timeline / AI review đọc được.
 *  - các trường văn bản tự do: ghi chú thêm, được NỐI SAU phần văn bản sinh từ `structured` của cùng mục.
 * Phải có ÍT NHẤT 1 nội dung (kiểm tra ở service).
 */
export class UpsertClinicalExaminationDto {
    @ApiPropertyOptional({ description: 'Tư thế bệnh nhân khi khám', maxLength: 255, example: 'Nằm ngửa, đầu cao 30 độ' })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    patientPosition?: string;

    @ApiPropertyOptional({ type: StructuredExaminationDto, description: 'Phiếu khám có cấu trúc (nhìn/sờ/gõ/nghe/nhận định)' })
    @IsOptional()
    @ValidateNested()
    @Type(() => StructuredExaminationDto)
    structured?: StructuredExaminationDto;

    @ApiPropertyOptional({ description: 'Nhìn — ghi chú tự do (nối sau phần sinh từ structured.inspection)' })
    @IsOptional()
    @IsString()
    @MaxLength(5000)
    inspectionFindings?: string;

    @ApiPropertyOptional({ description: 'Sờ — ghi chú tự do (nối sau phần sinh từ structured.palpation)' })
    @IsOptional()
    @IsString()
    @MaxLength(5000)
    palpationFindings?: string;

    @ApiPropertyOptional({ description: 'Gõ — ghi chú tự do (nối sau phần sinh từ structured.percussion)' })
    @IsOptional()
    @IsString()
    @MaxLength(5000)
    percussionFindings?: string;

    @ApiPropertyOptional({ description: 'Nghe tim — ghi chú tự do (nối sau phần sinh từ structured.auscultation)' })
    @IsOptional()
    @IsString()
    @MaxLength(5000)
    auscultationFindings?: string;

    @ApiPropertyOptional({
        description: 'Tóm tắt diễn tiến & đánh giá sơ bộ. Bỏ trống mà có structured.assessment thì tự sinh từ hội chứng + tóm tắt.',
    })
    @IsOptional()
    @IsString()
    @MaxLength(5000)
    clinicalNotes?: string;

    @ApiPropertyOptional({ description: 'Thời điểm khám (ISO 8601) — mặc định thời điểm gọi API' })
    @IsOptional()
    @IsISO8601()
    examinedAt?: string;
}
