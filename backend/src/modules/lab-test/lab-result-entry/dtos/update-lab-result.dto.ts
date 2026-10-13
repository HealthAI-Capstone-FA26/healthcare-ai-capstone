import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { LabResultValueDto } from './lab-result-value.dto';
import { LAB_RESULT_STATUSES, LabResultStatus } from './submit-lab-result.dto';

/**
 * Sửa/bổ sung kết quả đã lưu, hoặc xác nhận kết quả cuối (preliminary -> final). Chỉ field được gửi lên mới đổi.
 * Nếu kết quả đang 'final' mà có sửa `values`, `findings` hoặc `overallConclusion`, service tự chuyển 'corrected'
 * để lưu vết đính chính.
 */
export class UpdateLabResultDto {
    @ApiPropertyOptional({ description: 'Danh sách chỉ số cần sửa/bổ sung', type: [LabResultValueDto] })
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => LabResultValueDto)
    values?: LabResultValueDto[];

    @ApiPropertyOptional({ description: 'Mô tả chi tiết (báo cáo)' })
    @IsOptional()
    @IsString()
    findings?: string;

    @ApiPropertyOptional({ description: 'Kết luận tổng quát', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    overallConclusion?: string;

    @ApiPropertyOptional({ description: 'Trạng thái kết quả', enum: LAB_RESULT_STATUSES })
    @IsOptional()
    @IsIn(LAB_RESULT_STATUSES)
    resultStatus?: LabResultStatus;
}
