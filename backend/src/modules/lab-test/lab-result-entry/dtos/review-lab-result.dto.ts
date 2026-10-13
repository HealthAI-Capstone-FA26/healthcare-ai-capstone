import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Bác sĩ đọc/duyệt kết quả (vd: ECG, siêu âm). Ghi reviewedByUserId/reviewedAt; có thể chốt 'final' luôn. */
export class ReviewLabResultDto {
    @ApiPropertyOptional({ description: 'Kết luận của bác sĩ đọc kết quả (ghi đè overallConclusion)', maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    overallConclusion?: string;

    @ApiPropertyOptional({ description: "Chốt kết quả cuối ('preliminary'/'corrected' -> 'final')", default: false })
    @IsOptional()
    @IsBoolean()
    finalize?: boolean;
}
