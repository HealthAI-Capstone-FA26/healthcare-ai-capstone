import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

/**
 * Khác FindDiagnosesQueryDto của SE02 (mặc định KHÔNG lọc, trả mọi loại): ở SE05, mặc định (không truyền
 * diagnosisType) CHỈ trả chẩn đoán 'final' — controller này đại diện cho "kết luận chuyên môn". Muốn xem chẩn đoán
 * ban đầu/phân biệt thì truyền diagnosisType=initial | differential.
 */
export class FindFinalDiagnosesQueryDto {
    @ApiPropertyOptional({
        enum: ['initial', 'differential', 'final'],
        description: "Lọc theo loại chẩn đoán — mặc định 'final' nếu bỏ trống",
    })
    @IsOptional()
    @IsIn(['initial', 'differential', 'final'])
    diagnosisType?: 'initial' | 'differential' | 'final';
}
