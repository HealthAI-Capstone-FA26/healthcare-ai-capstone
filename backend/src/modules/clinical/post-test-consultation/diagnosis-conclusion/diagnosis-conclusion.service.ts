import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { ActorRoleService } from '../../../identity-access/user/actor-role.service';
import { DoctorService } from '../../../identity-access/doctor/doctor.service';
import { ACTOR_ROLE } from '../../../../common/constants/actor-role.constant';
import { Icd10CatalogService } from '../../icd10-catalog/icd10-catalog.service';
import { assertEncounterAwaitingReview } from '../shared/encounter-lab-results.util';
import { CreateDiagnosisConclusionDto } from './dto/create-diagnosis-conclusion.dto';
import { FindFinalDiagnosesQueryDto } from './dto/find-final-diagnoses-query.dto';

const DIAGNOSIS_TYPE_FINAL = 'final';

/**
 * SE05, "Kết luận chuyên môn (Bác sĩ)": ghi chẩn đoán CHÍNH THỨC (Diagnosis.diagnosisType='final') sau khi xem kết quả
 * cận lâm sàng. Danh mục bệnh lý chuẩn hoá ICD-10 (dùng chung Icd10CatalogService với SE02).
 *
 * Theo schema mới: Diagnosis.doctorId là Doctor.doctorId (không còn diagnosedByUserId) và không còn liên kết AI.
 *
 * CỔNG: chỉ ghi khi Encounter = 'awaiting_review' (lab-test đã báo mọi cận lâm sàng xong). Xem
 * assertEncounterAwaitingReview. Chẩn đoán final là căn cứ cho đơn thuốc ở SE06 (Prescription.diagnosisId).
 *
 * Quy tắc isPrimary: mỗi lượt khám tối đa 1 chẩn đoán final primary. Chẩn đoán final ĐẦU TIÊN tự là primary nếu bác sĩ
 * không nói gì; đặt isPrimary=true cho chẩn đoán mới sẽ hạ primary cũ (cùng transaction).
 */
@Injectable()
export class DiagnosisConclusionService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
        private readonly doctorService: DoctorService,
        private readonly icd10CatalogService: Icd10CatalogService,
    ) { }

    async create(encounterId: string, dto: CreateDiagnosisConclusionDto, currentUserId: string) {
        await this.actorRoleService.assertActorRole(currentUserId, [ACTOR_ROLE.DOCTOR]);
        const doctor = await this.doctorService.findByUserId(currentUserId);

        await assertEncounterAwaitingReview(this.prisma, encounterId);

        const icd10 = await this.icd10CatalogService.getByCode(dto.icd10Code);
        if (!icd10.isActive) {
            throw new BadRequestException(`Mã ICD-10 '${dto.icd10Code}' đã ngưng sử dụng, vui lòng chọn mã khác.`);
        }

        return this.prisma.$transaction(async (tx) => {
            const duplicate = await tx.diagnosis.findFirst({
                where: { encounterId, diagnosisType: DIAGNOSIS_TYPE_FINAL, icd10Code: dto.icd10Code },
                select: { diagnosisId: true },
            });
            if (duplicate) {
                throw new ConflictException(`Lượt khám đã có chẩn đoán chính thức mã ${dto.icd10Code} (${duplicate.diagnosisId}).`);
            }

            const existingPrimary = await tx.diagnosis.count({
                where: { encounterId, diagnosisType: DIAGNOSIS_TYPE_FINAL, isPrimary: true },
            });
            const isPrimary = dto.isPrimary ?? existingPrimary === 0;

            if (isPrimary && existingPrimary > 0) {
                await tx.diagnosis.updateMany({
                    where: { encounterId, diagnosisType: DIAGNOSIS_TYPE_FINAL, isPrimary: true },
                    data: { isPrimary: false },
                });
            }

            return tx.diagnosis.create({
                data: {
                    encounterId,
                    icd10Code: dto.icd10Code,
                    diagnosisName: dto.diagnosisName ?? icd10.icd10Name,
                    diagnosisType: DIAGNOSIS_TYPE_FINAL,
                    doctorId: doctor.doctorId,
                    isPrimary,
                    notes: dto.notes,
                    diagnosedAt: dto.diagnosedAt ? new Date(dto.diagnosedAt) : new Date(),
                },
                include: { icd10: true },
            });
        });
    }

    async findByEncounterId(encounterId: string, query: FindFinalDiagnosesQueryDto) {
        return this.prisma.diagnosis.findMany({
            where: { encounterId, diagnosisType: query.diagnosisType ?? DIAGNOSIS_TYPE_FINAL },
            orderBy: { diagnosedAt: 'desc' },
            include: { icd10: true },
        });
    }
}
