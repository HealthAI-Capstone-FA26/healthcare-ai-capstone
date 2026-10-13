import { IsBoolean, IsNumber, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 1 chỉ số kết quả (ResultValue). Đúng 1 trong 3 field valueNumeric / valueBoolean / valueText có giá trị, tuỳ
 * ResultParameter.dataType: numeric -> valueNumeric · boolean -> valueBoolean · text -> valueText ·
 * enum -> valueText (phải thuộc allowedValues). Service đối chiếu lại theo danh mục tham số (không tin client).
 */
export class LabResultValueDto {
    @ApiProperty({ description: 'ID tham số (ResultParameter) — phải thuộc dịch vụ của nhiệm vụ', format: 'uuid' })
    @IsUUID()
    parameterId: string;

    @ApiPropertyOptional({ description: 'Giá trị số (dataType = numeric)', example: 5.2 })
    @ValidateIf((o) => o.valueNumeric !== undefined)
    @Type(() => Number)
    @IsNumber()
    valueNumeric?: number;

    @ApiPropertyOptional({ description: 'Giá trị đúng/sai (dataType = boolean)' })
    @IsOptional()
    @IsBoolean()
    valueBoolean?: boolean;

    @ApiPropertyOptional({ description: 'Giá trị chữ (dataType = text | enum)', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    valueText?: string;
}
