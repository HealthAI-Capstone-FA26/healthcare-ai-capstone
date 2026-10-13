import { IsDateString, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LabReferenceRangeQueryDto {
    @ApiProperty({ description: 'ID dịch vụ cận lâm sàng (ServiceCatalog.serviceId) cần xem ngưỡng tham chiếu', format: 'uuid' })
    @IsUUID()
    serviceId: string;

    @ApiPropertyOptional({
        description: 'Thời điểm tính tuổi để tra ngưỡng (ISO 8601). Mặc định là thời điểm gọi API.',
        example: '2026-09-05T08:30:00.000Z',
    })
    @IsOptional()
    @IsDateString()
    at?: string;
}
