import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const ECG_REVIEW_VERDICTS = ['true_positive', 'false_positive', 'uncertain'] as const;

/** Bác sĩ xác nhận cảnh báo AI đúng/sai — nhãn dùng cho đánh giá/retrain model (chỉ khi có Consent phù hợp). */
export class ReviewEcgEventDto {
    @ApiProperty({ enum: ECG_REVIEW_VERDICTS })
    @IsIn(ECG_REVIEW_VERDICTS)
    verdict: (typeof ECG_REVIEW_VERDICTS)[number];

    @ApiPropertyOptional({ maxLength: 2000 })
    @IsOptional()
    @IsString()
    @MaxLength(2000)
    note?: string;
}
