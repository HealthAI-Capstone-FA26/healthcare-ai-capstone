import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Thông tin mẫu khi tiếp nhận — CHỈ áp dụng cho dịch vụ xét nghiệm máu (modality = blood_test).
 * Người tiếp nhận luôn lấy từ JWT, không còn nhận qua body.
 */
export class ReceiveLabTaskDto {
    @ApiPropertyOptional({ description: 'Mã vạch ống máu / mẫu (chỉ blood_test)', maxLength: 50 })
    @IsOptional()
    @IsString()
    @MaxLength(50)
    specimenCode?: string;

    @ApiPropertyOptional({ description: 'Thời điểm lấy mẫu (ISO 8601, chỉ blood_test) — mặc định lúc tiếp nhận' })
    @IsOptional()
    @IsISO8601()
    specimenCollectedAt?: string;
}
