import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/**
 * Khác với FindDiagnosesQueryDto của Module 5 (mặc định KHÔNG lọc, trả cả preliminary lẫn final):
 * ở Module 8, mặc định (không truyền diagnosisType) CHỈ trả chẩn đoán 'final' — vì controller này
 * đại diện cho "kết luận chuyên môn", muốn xem cả chẩn đoán sơ bộ thì truyền diagnosisType=preliminary.
 */
export class FindFinalDiagnosesQueryDto {
    @ApiPropertyOptional({
        enum: ['preliminary', 'final'],
        description: "Lọc theo loại chẩn đoán — mặc định 'final' nếu bỏ trống",
    })
    @IsOptional()
    @IsIn(['preliminary', 'final'])
    diagnosisType?: 'preliminary' | 'final';
}
