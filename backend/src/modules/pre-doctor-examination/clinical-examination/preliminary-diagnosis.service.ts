import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ActorRoleService } from '../../user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { EncounterStatus } from '../../../common/utils/encounter-status.util';
import { Icd10CatalogService } from '../../shared/icd10-catalog/icd10-catalog.service';
import { CreatePreliminaryDiagnosisDto } from './dto/create-preliminary-diagnosis.dto';
import { FindDiagnosesQueryDto } from './dto/find-diagnoses-query.dto';

const DIAGNOSIS_TYPE_PRELIMINARY = 'preliminary';

/**
 * Module 5, mục "Ghi nhận chẩn đoán" (phần chẩn đoán sơ bộ). Tạo bản ghi Diagnosis với
 * diagnosisType='preliminary'. Lưu ý: Diagnosis.diagnosedByUserId là User.userId (không phải
 * Doctor.doctorId như ClinicalExamination) — theo đúng schema, nên không cần tra DoctorService ở đây.
 *
 * Chẩn đoán CHÍNH THỨC (diagnosisType='final', chấp nhận/phủ quyết gợi ý AI) thuộc Module 8 —
 * xem post-test-consultation/diagnosis-conclusion.
 */
@Injectable()
export class PreliminaryDiagnosisService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
        private readonly icd10CatalogService: Icd10CatalogService,
    ) {}

    async create(encounterId: string, dto: CreatePreliminaryDiagnosisDto, currentUserId: string) {
        await this.actorRoleService.assertActorRole(currentUserId, [ACTOR_ROLE.DOCTOR]);

        const encounter = await this.prisma.encounter.findUnique({ where: { encounterId } });
        if (!encounter) {
            throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
        }
        if (encounter.status === EncounterStatus.CANCELLED || encounter.status === EncounterStatus.FINISHED) {
            throw new BadRequestException(
                `Lượt khám đang ở trạng thái '${encounter.status}', không thể ghi nhận chẩn đoán.`,
            );
        }

        const icd10 = await this.icd10CatalogService.getByCode(dto.icd10Code);
        if (!icd10.isActive) {
            throw new BadRequestException(`Mã ICD-10 '${dto.icd10Code}' đã ngưng sử dụng, vui lòng chọn mã khác.`);
        }

        if (dto.aiSuggestionId) {
            const suggestion = await this.prisma.aiDiagnosisSuggestion.findUnique({
                where: { suggestionId: dto.aiSuggestionId },
            });
            if (!suggestion || suggestion.encounterId !== encounterId) {
                throw new BadRequestException('Gợi ý chẩn đoán AI được tham chiếu không thuộc lượt khám này.');
            }
        }

        return this.prisma.diagnosis.create({
            data: {
                encounterId,
                icd10Code: dto.icd10Code,
                diagnosisName: dto.diagnosisName ?? icd10.icd10Name,
                diagnosisType: DIAGNOSIS_TYPE_PRELIMINARY,
                aiSuggestionId: dto.aiSuggestionId,
                diagnosedByUserId: currentUserId,
                isPrimary: dto.isPrimary ?? false,
                notes: dto.notes,
                diagnosedAt: dto.diagnosedAt ? new Date(dto.diagnosedAt) : new Date(),
            },
            include: { icd10: true },
        });
    }

    async findByEncounterId(encounterId: string, query: FindDiagnosesQueryDto) {
        return this.prisma.diagnosis.findMany({
            where: { encounterId, ...(query.diagnosisType ? { diagnosisType: query.diagnosisType } : {}) },
            orderBy: { diagnosedAt: 'desc' },
            include: { icd10: true, aiSuggestion: true },
        });
    }
}
