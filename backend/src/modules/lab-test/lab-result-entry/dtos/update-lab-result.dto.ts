import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { LabResultValueDto } from './lab-result-value.dto';
import { LAB_RESULT_STATUSES, LabResultStatus } from './submit-lab-result.dto';

/**
 * Sửa/bổ sung kết quả đã lưu (VD: đính chính sau khi phát hiện nhập sai) hoặc xác nhận
 * kết quả cuối cùng (resultStatus: 'preliminary' -> 'final'). Chỉ field được gửi lên mới thay đổi.
 * Nếu resultStatus hiện tại đã là 'final' và có gửi lên `values`, service sẽ tự chuyển
 * resultStatus thành 'corrected' để lưu vết lịch sử đính chính trên EMR.
 */
export class UpdateLabResultDto {
    @ApiPropertyOptional({ description: 'Danh sách chỉ số cần sửa/bổ sung', type: [LabResultValueDto] })
    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => LabResultValueDto)
    values?: LabResultValueDto[];

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
