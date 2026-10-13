import { IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { LabResultValueDto } from './lab-result-value.dto';

export const LAB_RESULT_STATUSES = ['preliminary', 'final', 'corrected', 'cancelled'] as const;
export type LabResultStatus = (typeof LAB_RESULT_STATUSES)[number];

/**
 * Nhập kết quả cho 1 DiagnosticTask đang 'in_progress' (đã qua ràng buộc thanh toán). Yêu cầu theo
 * ServiceCatalog.resultKind của dịch vụ:
 *   - parametric   : `values` ≥ 1 (hs-Troponin, NT-proBNP, lipid, ...)
 *   - image_report : `findings` hoặc `overallConclusion` (X-quang, siêu âm); ảnh/DICOM thêm sau qua /attachments
 *   - waveform     : `findings` hoặc đã có EcgRecording hoàn tất của task (ECG)
 */
export class SubmitLabResultDto {
    @ApiPropertyOptional({ description: 'Danh sách chỉ số (bắt buộc với dịch vụ parametric)', type: [LabResultValueDto] })
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => LabResultValueDto)
    values?: LabResultValueDto[];

    @ApiPropertyOptional({ description: 'Mô tả chi tiết (báo cáo X-quang/siêu âm/ECG)' })
    @IsOptional()
    @IsString()
    findings?: string;

    @ApiPropertyOptional({ description: 'Kết luận tổng quát', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    overallConclusion?: string;

    @ApiPropertyOptional({
        description: 'Trạng thái kết quả — mặc định preliminary (chờ xác nhận cuối)',
        enum: LAB_RESULT_STATUSES,
        default: 'preliminary',
    })
    @IsOptional()
    @IsIn(LAB_RESULT_STATUSES)
    resultStatus?: LabResultStatus;

    @ApiPropertyOptional({ description: 'Thời điểm thực hiện thủ thuật (ISO 8601) — mặc định thời điểm nhận task' })
    @IsOptional()
    @IsDateString()
    performedAt?: string;

    @ApiPropertyOptional({ description: 'Thời điểm có kết quả (ISO 8601) — mặc định thời điểm gọi API' })
    @IsOptional()
    @IsDateString()
    resultedAt?: string;
}
