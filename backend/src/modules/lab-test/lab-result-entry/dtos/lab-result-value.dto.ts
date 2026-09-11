import { IsNumber, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 1 chỉ số kết quả xét nghiệm. Đúng 1 trong 2 field valueNumeric/valueText phải có giá trị,
 * tuỳ theo LabResultParameter.dataType (numeric -> valueNumeric, positive_negative/text -> valueText).
 * Việc đối chiếu đúng dataType được service kiểm tra lại theo danh mục tham số (không tin client).
 */
export class LabResultValueDto {
    @ApiProperty({ description: 'ID tham số xét nghiệm (LabResultParameter)', format: 'uuid' })
    @IsUUID()
    parameterId: string;

    @ApiPropertyOptional({ description: 'Giá trị số (dùng khi dataType = numeric)', example: 5.2 })
    @ValidateIf((o) => o.valueNumeric !== undefined)
    @Type(() => Number)
    @IsNumber()
    valueNumeric?: number;

    @ApiPropertyOptional({
        description: "Giá trị dạng chữ (dùng khi dataType = positive_negative | text), VD: 'Negative', 'Âm tính'",
        maxLength: 255,
    })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    valueText?: string;
}
