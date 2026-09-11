import { ArrayMinSize, IsArray, IsDateString, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LabResultValueDto } from './lab-result-value.dto';

export const LAB_RESULT_STATUSES = ['preliminary', 'final', 'corrected', 'cancelled'] as const;
export type LabResultStatus = (typeof LAB_RESULT_STATUSES)[number];

/**
 * Kỹ thuật viên nhập kết quả cho 1 LabTask đang 'in_progress'. Chỉ được phép nhập
 * khi nhiệm vụ đã qua ràng buộc thanh toán (được LabTaskService.assertReadyForResultEntry kiểm tra).
 */
export class SubmitLabResultDto {
    @ApiProperty({ description: 'Danh sách chỉ số kết quả', type: [LabResultValueDto] })
    @IsArray()
    @ArrayMinSize(1, { message: 'Cần nhập ít nhất một chỉ số kết quả.' })
    @ValidateNested({ each: true })
    @Type(() => LabResultValueDto)
    values: LabResultValueDto[];

    @ApiPropertyOptional({ description: 'Kết luận tổng quát của kỹ thuật viên/bác sĩ đọc kết quả', maxLength: 255 })
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

    @ApiPropertyOptional({ description: 'Thời điểm có kết quả (ISO 8601). Mặc định là thời điểm gọi API.' })
    @IsOptional()
    @IsDateString()
    resultedAt?: string;
}
