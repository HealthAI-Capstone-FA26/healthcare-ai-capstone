import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ActorRoleService } from '../../user/actor-role.service';
import { DoctorService } from '../../doctor/doctor.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { assertEncounterAwaitingReview } from '../shared/encounter-lab-results.util';
import { UpsertTreatmentConsultationDto } from './dto/upsert-treatment-consultation.dto';

const DIAGNOSIS_TYPE_FINAL = 'final';

/**
 * SE05, "Tư vấn điều trị": ghi nhận TreatmentConsultation (1-1 với Encounter, gọi lại là upsert).
 *
 * Tiền điều kiện:
 *  - Encounter đang 'awaiting_review' (cả tạo lần đầu lẫn sửa) — cùng cổng với kết luận chẩn đoán;
 *  - LẦN ĐẦU tạo: đã có ÍT NHẤT 1 chẩn đoán CHÍNH THỨC (final) — tư vấn luôn dựa trên kết luận đã chốt.
 *
 * KHÔNG còn đổi trạng thái Encounter. Bản cũ tự chuyển 'finished' ngay lần tạo đầu, khiến SE06 không thể kê đơn
 * (prescription chặn encounter đã 'finished'). Theo thiết kế mới: bác sĩ kê đơn + hẹn tái khám ở SE06, và việc
 * đóng lượt khám ('awaiting_review' -> 'finished') thuộc SE06. Sau khi SE06 đóng, encounter 'finished' nên không
 * sửa được tư vấn nữa (không sửa hồ sơ sau khi đã kết thúc).
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

        await assertEncounterAwaitingReview(this.prisma, encounterId);

        const existing = await this.prisma.treatmentConsultation.findUnique({
            where: { encounterId },
            select: { consultationId: true },
        });

        if (!existing) {
            const finalDiagnosisCount = await this.prisma.diagnosis.count({
                where: { encounterId, diagnosisType: DIAGNOSIS_TYPE_FINAL },
            });
            if (finalDiagnosisCount === 0) {
                throw new BadRequestException(
                    'Lượt khám chưa có chẩn đoán chính thức (final) nào — cần hoàn tất bước kết luận chuyên môn ' +
                        '(post-test-consultation/.../diagnosis-conclusion) trước khi tư vấn điều trị.',
                );
            }
        }

        const followUpRequired = dto.followUpRequired ?? false;
        const data = {
            doctorId: doctor.doctorId,
            conditionExplanation: dto.conditionExplanation,
            treatmentPlan: dto.treatmentPlan,
            lifestyleAdvice: dto.lifestyleAdvice,
            nutritionAdvice: dto.nutritionAdvice,
            followUpRequired,
            followUpIntervalDays: followUpRequired ? (dto.followUpIntervalDays ?? null) : null,
            consultedAt: dto.consultedAt ? new Date(dto.consultedAt) : new Date(),
        };

        return this.prisma.treatmentConsultation.upsert({
            where: { encounterId },
            create: { encounterId, ...data },
            update: data,
            include: { doctor: true },
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
