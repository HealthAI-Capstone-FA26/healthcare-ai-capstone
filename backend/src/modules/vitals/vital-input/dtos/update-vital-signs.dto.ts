import { IsOptional, IsString, IsDateString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { VitalMeasurementsDto } from './vital-measurements.dto';

/**
 * Dữ liệu điều dưỡng gửi lên khi sửa lại chỉ số đã nhập sai, hoặc bổ sung chỉ số
 * còn thiếu cho một lần đo đã lưu. Chỉ những field được truyền lên (khác undefined)
 * mới được cập nhật — field không gửi lên giữ nguyên giá trị cũ.
 */
export class UpdateVitalSignsDto extends VitalMeasurementsDto {
    @ApiPropertyOptional({
        description: 'Thời điểm đo (ISO 8601). Chỉ gửi lên nếu muốn sửa lại.',
        example: '2026-09-05T08:30:00.000Z',
    })
    @IsOptional()
    @IsDateString()
    measuredAt?: string;

    @ApiPropertyOptional({ description: 'Ghi chú thêm của điều dưỡng', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    notes?: string;
}
