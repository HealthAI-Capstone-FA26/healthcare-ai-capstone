import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ActorRoleService } from '../../user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { EncounterStatus } from '../../../common/utils/encounter-status.util';
import { Icd10CatalogService } from '../../shared/icd10-catalog/icd10-catalog.service';
import { getEncounterLabResults, hasFinalizedLabResult } from '../shared/encounter-lab-results.util';
import { CreateDiagnosisConclusionDto } from './dto/create-diagnosis-conclusion.dto';
import { RejectAiSuggestionDto } from './dto/reject-ai-suggestion.dto';
import { FindFinalDiagnosesQueryDto } from './dto/find-final-diagnoses-query.dto';

const DIAGNOSIS_TYPE_FINAL = 'final';
const AI_SOURCE_TYPE_COMPREHENSIVE_REVIEW = 'comprehensive_review';

/**
 * Module 8, mục "Kết luận chuyên môn (Bác sĩ)":
 *   - Bác sĩ ra chẩn đoán CHÍNH THỨC (Diagnosis.diagnosisType='final') bằng cách Chấp nhận hoặc
 *     Phủ quyết đề xuất của AI (kèm lý do nếu phủ quyết) — xem CreateDiagnosisConclusionDto.
 *   - Danh mục bệnh lý chuẩn hoá theo ICD-10 (dùng chung Icd10CatalogService với Module 5).
 *
 * Lưu ý theo đúng schema (giống PreliminaryDiagnosisService của Module 5): Diagnosis.diagnosedByUserId
 * là User.userId (không phải Doctor.doctorId) — nên không cần tra DoctorService ở đây.
 *
 * Business rule RIÊNG của Module 8 (không có ở Module 5): chặn tạo chẩn đoán CHÍNH THỨC nếu lượt
 * khám CHƯA có bất kỳ kết quả xét nghiệm nào được chốt (resultStatus final|corrected) — đúng đúng
 * tinh thần "chẩn đoán hậu xét nghiệm". Nếu bác sĩ cần kết luận mà không cần chờ xét nghiệm (VD:
 * không chỉ định xét nghiệm nào), dùng chẩn đoán sơ bộ ở Module 5 là đủ; API này dành riêng cho
 * bước tư vấn SAU xét nghiệm như mô tả nghiệp vụ.
 */
@Injectable()
export class DiagnosisConclusionService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
        private readonly icd10CatalogService: Icd10CatalogService,
    ) {}

    async create(encounterId: string, dto: CreateDiagnosisConclusionDto, currentUserId: string) {
        await this.actorRoleService.assertActorRole(currentUserId, [ACTOR_ROLE.DOCTOR]);

        const encounter = await this.assertEncounterConcludable(encounterId);

        const icd10 = await this.icd10CatalogService.getByCode(dto.icd10Code);
        if (!icd10.isActive) {
            throw new BadRequestException(`Mã ICD-10 '${dto.icd10Code}' đã ngưng sử dụng, vui lòng chọn mã khác.`);
        }

        let aiDecision = dto.aiDecision;

        return this.prisma.$transaction(async (tx) => {
            if (dto.aiSuggestionId) {
                const suggestion = await tx.aiDiagnosisSuggestion.findUnique({ where: { suggestionId: dto.aiSuggestionId } });
                if (
                    !suggestion ||
                    suggestion.encounterId !== encounterId ||
                    suggestion.sourceType !== AI_SOURCE_TYPE_COMPREHENSIVE_REVIEW
                ) {
                    throw new BadRequestException(
                        'Gợi ý chẩn đoán AI được tham chiếu không thuộc lượt khám này hoặc không phải gợi ý toàn diện (comprehensive_review).',
                    );
                }

                // Không truyền aiDecision -> tự suy luận: trùng mã ICD-10 gợi ý = accepted, khác = modified.
                if (!aiDecision) {
                    aiDecision = suggestion.icd10Code === dto.icd10Code ? 'accepted' : 'modified';
                }

                await tx.aiDiagnosisSuggestion.update({
                    where: { suggestionId: suggestion.suggestionId },
                    data: {
                        doctorFeedback: aiDecision,
                        rejectionReason: aiDecision === 'rejected' ? dto.rejectionReason : null,
                        reviewedByUserId: currentUserId,
                        reviewedAt: new Date(),
                    },
                });
            }

            const diagnosis = await tx.diagnosis.create({
                data: {
                    encounterId,
                    icd10Code: dto.icd10Code,
                    diagnosisName: dto.diagnosisName ?? icd10.icd10Name,
                    diagnosisType: DIAGNOSIS_TYPE_FINAL,
                    aiSuggestionId: dto.aiSuggestionId,
                    diagnosedByUserId: currentUserId,
                    isPrimary: dto.isPrimary ?? false,
                    notes: dto.notes,
                    diagnosedAt: dto.diagnosedAt ? new Date(dto.diagnosedAt) : new Date(),
                },
                include: { icd10: true, aiSuggestion: true },
            });

            return diagnosis;
        });
    }

    /** Phủ quyết 1 gợi ý AI (comprehensive_review) mà KHÔNG kèm tạo Diagnosis — xem RejectAiSuggestionDto. */
    async rejectAiSuggestion(encounterId: string, suggestionId: string, dto: RejectAiSuggestionDto, currentUserId: string) {
        await this.actorRoleService.assertActorRole(currentUserId, [ACTOR_ROLE.DOCTOR]);

        const suggestion = await this.prisma.aiDiagnosisSuggestion.findUnique({ where: { suggestionId } });
        if (
            !suggestion ||
            suggestion.encounterId !== encounterId ||
            suggestion.sourceType !== AI_SOURCE_TYPE_COMPREHENSIVE_REVIEW
        ) {
            throw new NotFoundException(
                `Không tìm thấy gợi ý chẩn đoán toàn diện ${suggestionId} thuộc lượt khám ${encounterId}`,
            );
        }

        return this.prisma.aiDiagnosisSuggestion.update({
            where: { suggestionId },
            data: {
                doctorFeedback: 'rejected',
                rejectionReason: dto.reason,
                reviewedByUserId: currentUserId,
                reviewedAt: new Date(),
            },
            include: { icd10: true },
        });
    }

    async findByEncounterId(encounterId: string, query: FindFinalDiagnosesQueryDto) {
        return this.prisma.diagnosis.findMany({
            where: { encounterId, diagnosisType: query.diagnosisType ?? DIAGNOSIS_TYPE_FINAL },
            orderBy: { diagnosedAt: 'desc' },
            include: { icd10: true, aiSuggestion: true },
        });
    }

    /**
     * Chặn khi lượt khám không tồn tại/đã huỷ/đã kết thúc, hoặc chưa có kết quả xét nghiệm nào
     * được chốt — dùng chung cho DiagnosisConclusionService và TreatmentConsultationService
     * (2 bước liên tiếp cùng đòi hỏi tiền điều kiện "đã có kết quả xét nghiệm").
     */
    async assertEncounterConcludable(encounterId: string) {
        const encounter = await this.prisma.encounter.findUnique({ where: { encounterId } });
        if (!encounter) {
            throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
        }
        if (encounter.status === EncounterStatus.CANCELLED || encounter.status === EncounterStatus.FINISHED) {
            throw new BadRequestException(
                `Lượt khám đang ở trạng thái '${encounter.status}', không thể ghi nhận kết luận chuyên môn.`,
            );
        }

        const labResultRows = await getEncounterLabResults(this.prisma, encounterId);
        if (!hasFinalizedLabResult(labResultRows)) {
            throw new BadRequestException(
                'Lượt khám chưa có kết quả xét nghiệm nào được chốt (final/corrected) — chưa thể ghi nhận ' +
                    'kết luận chuyên môn hậu xét nghiệm. Nếu không có chỉ định xét nghiệm, dùng chẩn đoán sơ ' +
                    'bộ ở Module 5 (doctor-examination/.../diagnoses).',
            );
        }

        return encounter;
    }
}
