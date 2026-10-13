import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

/** Chạy lại phân tích (reanalysis) — dùng khi có model mới hoặc muốn thử ngưỡng khác (vd: đánh giá model candidate trên benchmark). */
export class ReanalyzeEcgDto {
    @ApiPropertyOptional({ description: "AiModelVersion cần dùng (status 'active' hoặc 'candidate'). Bỏ trống = model 'active' mới nhất.", format: 'uuid' })
    @IsOptional()
    @IsUUID()
    modelVersionId?: string;

    @ApiPropertyOptional({ description: 'Ngưỡng điểm bất thường (0..1). Bỏ trống = ngưỡng mặc định của model.', minimum: 0, maximum: 1 })
    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(1)
    threshold?: number;
}
