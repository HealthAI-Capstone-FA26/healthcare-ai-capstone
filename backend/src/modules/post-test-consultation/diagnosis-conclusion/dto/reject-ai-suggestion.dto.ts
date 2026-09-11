import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

/**
 * Phủ quyết 1 gợi ý AI (comprehensive_review) mà KHÔNG kèm tạo chẩn đoán chính thức — dùng khi
 * bác sĩ xem qua top-k gợi ý và muốn loại các gợi ý không phù hợp trước khi (hoặc mà không cần)
 * tạo Diagnosis cho gợi ý còn lại qua CreateDiagnosisConclusionDto.
 */
export class RejectAiSuggestionDto {
    @ApiPropertyOptional({ description: 'Lý do phủ quyết gợi ý AI' })
    @IsNotEmpty({ message: 'reason không được để trống' })
    @IsString()
    reason: string;
}
