import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';

export type AiDiagnosisDecision = 'accepted' | 'rejected' | 'modified';

/**
 * Ghi nhận 1 chẩn đoán CHÍNH THỨC (Module 8, mục "Kết luận chuyên môn"). Diagnosis.diagnosisType
 * luôn là 'final' khi tạo qua API này — đối lập với chẩn đoán sơ bộ (diagnosisType='preliminary')
 * được tạo ở Module 5 (xem pre-doctor-examination/clinical-examination/preliminary-diagnosis).
 *
 * Nếu bác sĩ dựa trên (hoặc đối chiếu với) 1 gợi ý AI cụ thể — truyền `aiSuggestionId` (phải thuộc
 * nhóm comprehensive_review của CHÍNH lượt khám này) kèm `aiDecision`:
 *   - 'accepted' : chọn đúng theo gợi ý AI (icd10Code nên trùng gợi ý).
 *   - 'modified' : có tham khảo gợi ý AI nhưng ra chẩn đoán khác/điều chỉnh.
 *   - 'rejected' : phủ quyết hoàn toàn gợi ý AI — BẮT BUỘC kèm `rejectionReason`.
 * Nếu không truyền `aiDecision`, hệ thống tự suy luận: icd10Code trùng gợi ý -> 'accepted', khác -> 'modified'.
 */
export class CreateDiagnosisConclusionDto {
    @ApiPropertyOptional({ description: 'Mã ICD-10 của chẩn đoán chính thức', example: 'J18.9' })
    @IsNotEmpty({ message: 'icd10Code không được để trống' })
    @IsString()
    icd10Code: string;

    @ApiPropertyOptional({ description: 'Tên chẩn đoán hiển thị — nếu bỏ trống sẽ lấy theo tên chuẩn ICD-10' })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    diagnosisName?: string;

    @ApiPropertyOptional({ description: 'Đây có phải chẩn đoán chính (primary) hay không', default: false })
    @IsOptional()
    @IsBoolean()
    isPrimary?: boolean;

    @ApiPropertyOptional({ maxLength: 255 })
    @IsOptional()
    @IsString()
    @MaxLength(255)
    notes?: string;

    @ApiPropertyOptional({
        description: 'Gợi ý AI (comprehensive_review) mà bác sĩ tham khảo/đối chiếu khi ra kết luận này',
        format: 'uuid',
    })
    @IsOptional()
    @IsUUID()
    aiSuggestionId?: string;

    @ApiPropertyOptional({
        description: 'Quyết định của bác sĩ đối với aiSuggestionId — bắt buộc nếu có aiSuggestionId',
        enum: ['accepted', 'rejected', 'modified'],
    })
    @ValidateIf((dto: CreateDiagnosisConclusionDto) => !!dto.aiSuggestionId)
    @IsIn(['accepted', 'rejected', 'modified'], { message: 'aiDecision phải là accepted | rejected | modified' })
    aiDecision?: AiDiagnosisDecision;

    @ApiPropertyOptional({ description: 'Lý do phủ quyết gợi ý AI — bắt buộc khi aiDecision = rejected' })
    @ValidateIf((dto: CreateDiagnosisConclusionDto) => dto.aiDecision === 'rejected')
    @IsNotEmpty({ message: 'rejectionReason không được để trống khi phủ quyết gợi ý AI' })
    @IsString()
    rejectionReason?: string;

    @ApiPropertyOptional({ description: 'Thời điểm ra kết luận (ISO 8601) — mặc định thời điểm gọi API' })
    @IsOptional()
    @IsISO8601()
    diagnosedAt?: string;
}
