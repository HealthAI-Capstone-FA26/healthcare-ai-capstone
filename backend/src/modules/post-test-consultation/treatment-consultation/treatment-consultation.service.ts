import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ActorRoleService } from '../../user/actor-role.service';
import { DoctorService } from '../../doctor/doctor.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { EncounterStatus } from '../../../common/utils/encounter-status.util';
import { UpsertTreatmentConsultationDto } from './dto/upsert-treatment-consultation.dto';

const DIAGNOSIS_TYPE_FINAL = 'final';

/**
 * Module 8, mục "Tư vấn điều trị": ghi nhận TreatmentConsultation (1-1 với Encounter, gọi lại là
 * upsert — cùng cách ClinicalExaminationService của Module 5 xử lý ClinicalExamination).
 *
 * Tiền điều kiện: lượt khám phải đã có ÍT NHẤT 1 chẩn đoán CHÍNH THỨC (diagnosisType='final', xem
 * DiagnosisConclusionService) — tư vấn điều trị luôn dựa trên 1 kết luận chẩn đoán đã chốt, không
 * thể tư vấn "khống" khi chưa biết bệnh nhân bị gì.
 *
 * Tác dụng phụ nghiệp vụ (side effect, cùng tinh thần với ClinicalExaminationService.upsert() ở
 * Module 5 tự chuyển Encounter -> 'in_progress'): LẦN ĐẦU tạo TreatmentConsultation, nếu Encounter
 * đang 'in_progress' thì tự động chuyển sang 'finished' (đặt finishedAt) — coi tư vấn điều trị là
 * điểm KẾT THÚC lượt khám, vì hệ thống hiện CHƯA có module nào khác (thanh toán/đóng hồ sơ) đảm
 * nhận việc này. Nếu sau này có module đảm nhận việc "đóng lượt khám" theo tiêu chí khác (VD: đã
 * thanh toán đầy đủ), CẦN rà soát lại side effect này thay vì chỉ đơn giản bỏ đi, để không có
 * khoảng trống khiến Encounter kẹt mãi ở 'in_progress'.
 *
 * Vì Encounter đã chuyển 'finished' ngay sau lần tạo đầu, các service khác (test-order, clinical-
 * examination, diagnosis...) đều chặn thao tác tiếp khi status='finished' — ĐÚNG Ý ĐỒ nghiệp vụ
 * (không sửa hồ sơ sau khi đã tư vấn xong). Riêng update() của chính service này vẫn cho phép sửa
 * TreatmentConsultation dù Encounter đã 'finished', vì chính hành động tạo nó mới là nguyên nhân
 * gây ra trạng thái đó (không tự chặn chính mình).
 */
@Injectable()
export class TreatmentConsultationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
        private readonly doctorService: DoctorService,
    ) {}

    async upsert(encounterId: string, dto: UpsertTreatmentConsultationDto, currentUserId: string) {
        await this.actorRoleService.assertActorRole(currentUserId, [ACTOR_ROLE.DOCTOR]);
        const doctor = await this.doctorService.findByUserId(currentUserId);

        const encounter = await this.prisma.encounter.findUnique({
            where: { encounterId },
            include: { treatmentConsultation: true },
        });
        if (!encounter) {
            throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
        }
        if (encounter.status === EncounterStatus.CANCELLED) {
            throw new BadRequestException(`Lượt khám đã huỷ, không thể ghi nhận tư vấn điều trị.`);
        }

        const isFirstTimeCreate = !encounter.treatmentConsultation;

        if (isFirstTimeCreate) {
            const finalDiagnosisCount = await this.prisma.diagnosis.count({
                where: { encounterId, diagnosisType: DIAGNOSIS_TYPE_FINAL },
            });
            if (finalDiagnosisCount === 0) {
                throw new BadRequestException(
                    'Lượt khám chưa có chẩn đoán chính thức (final) nào — cần hoàn tất bước kết luận ' +
                        'chuyên môn (post-test-consultation/.../diagnosis-conclusion) trước khi tư vấn điều trị.',
                );
            }
        }

        const consultedAt = dto.consultedAt ? new Date(dto.consultedAt) : new Date();

        return this.prisma.$transaction(async (tx) => {
            const consultation = await tx.treatmentConsultation.upsert({
                where: { encounterId },
                create: {
                    encounterId,
                    doctorId: doctor.doctorId,
                    conditionExplanation: dto.conditionExplanation,
                    treatmentPlan: dto.treatmentPlan,
                    lifestyleAdvice: dto.lifestyleAdvice,
                    nutritionAdvice: dto.nutritionAdvice,
                    followUpRequired: dto.followUpRequired ?? false,
                    followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : null,
                    consultedAt,
                },
                update: {
                    doctorId: doctor.doctorId,
                    conditionExplanation: dto.conditionExplanation,
                    treatmentPlan: dto.treatmentPlan,
                    lifestyleAdvice: dto.lifestyleAdvice,
                    nutritionAdvice: dto.nutritionAdvice,
                    followUpRequired: dto.followUpRequired ?? false,
                    followUpDate: dto.followUpDate ? new Date(dto.followUpDate) : null,
                    consultedAt,
                },
                include: { doctor: true },
            });

            if (isFirstTimeCreate && encounter.status === EncounterStatus.IN_PROGRESS) {
                await tx.encounter.update({
                    where: { encounterId },
                    data: { status: EncounterStatus.FINISHED, finishedAt: new Date() },
                });
            }

            return consultation;
        });
    }

    async findByEncounterId(encounterId: string) {
        const consultation = await this.prisma.treatmentConsultation.findUnique({
            where: { encounterId },
            include: { doctor: true },
        });

        if (!consultation) {
            throw new NotFoundException(`Lượt khám ${encounterId} chưa có bản ghi tư vấn điều trị`);
        }

        return consultation;
    }
}
