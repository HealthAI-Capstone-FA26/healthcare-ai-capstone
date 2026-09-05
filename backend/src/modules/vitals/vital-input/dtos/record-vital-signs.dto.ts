import { IsUUID, IsOptional, IsString, IsDateString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VitalMeasurementsDto } from './vital-measurements.dto';

/**
 * Dữ liệu điều dưỡng nhập khi ghi nhận sinh hiệu / thể trạng cho một lượt khám (encounter).
 * Tất cả chỉ số đều optional ở cấp DTO — nhưng service sẽ yêu cầu có ít nhất 1 chỉ số
 * (không cho tạo 1 session rỗng không có observation nào).
 *
 * BMI KHÔNG có field riêng ở đây — được hệ thống tự tính từ height + weight nếu cả 2 đều có.
 */
export class RecordVitalSignsDto extends VitalMeasurementsDto {
    @ApiProperty({ description: 'ID lượt khám (encounter)', format: 'uuid' })
    @IsUUID()
    encounterId: string;

    @ApiProperty({ description: 'ID bệnh nhân', format: 'uuid' })
    @IsUUID()
    patientId: string;

    // TODO: khi có auth module, lấy từ req.user (JWT) thay vì client tự truyền lên.
    @ApiProperty({ description: 'ID người dùng (điều dưỡng) thực hiện ghi nhận', format: 'uuid' })
    @IsUUID()
    recordedByUserId: string;

    @ApiPropertyOptional({
        description: 'Thời điểm đo (ISO 8601). Mặc định là thời điểm gọi API nếu không truyền.',
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
