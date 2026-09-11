import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ActorRoleService } from '../../user/actor-role.service';
import { DoctorService } from '../../doctor/doctor.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { EncounterStatus } from '../../../common/utils/encounter-status.util';
import { UpsertClinicalExaminationDto } from './dto/upsert-clinical-examination.dto';

/**
 * Module 5, mục "Ghi nhận chẩn đoán" (phần khám lâm sàng): bác sĩ nhập kết quả thăm khám.
 * Mỗi Encounter chỉ có 1 ClinicalExamination (unique theo encounterId) — gọi lại là upsert.
 *
 * Tác dụng phụ nghiệp vụ: đây cũng là hành động "bác sĩ bắt đầu khám", nên nếu Encounter đang ở
 * 'waiting_for_doctor' thì tự động chuyển sang 'in_progress'. Việc "gọi bệnh nhân vào phòng khám"
 * (Module 6, hàng đợi DoctorQueueEntry) hiện chưa có trong hệ thống — coi hành động ghi nhận khám
 * lâm sàng là điểm bắt đầu 'in_progress' để không chặn luồng khám khi Module 6 chưa tồn tại.
 */
@Injectable()
export class ClinicalExaminationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
        private readonly doctorService: DoctorService,
    ) {}

    async upsert(encounterId: string, dto: UpsertClinicalExaminationDto, currentUserId: string) {
        await this.actorRoleService.assertActorRole(currentUserId, [ACTOR_ROLE.DOCTOR]);
        const doctor = await this.doctorService.findByUserId(currentUserId);

        const encounter = await this.prisma.encounter.findUnique({ where: { encounterId } });
        if (!encounter) {
            throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
        }

        if (encounter.status === EncounterStatus.CANCELLED || encounter.status === EncounterStatus.FINISHED) {
            throw new BadRequestException(
                `Lượt khám đang ở trạng thái '${encounter.status}', không thể ghi nhận khám lâm sàng.`,
            );
        }

        if (
            encounter.status === EncounterStatus.ARRIVED ||
            encounter.status === EncounterStatus.REGISTERED
        ) {
            throw new BadRequestException(
                `Lượt khám chưa tới lượt bác sĩ (đang ở trạng thái '${encounter.status}'), chưa thể ghi nhận khám lâm sàng.`,
            );
        }

        const examinedAt = dto.examinedAt ? new Date(dto.examinedAt) : new Date();

        return this.prisma.$transaction(async (tx) => {
            const examination = await tx.clinicalExamination.upsert({
                where: { encounterId },
                create: {
                    encounterId,
                    doctorId: doctor.doctorId,
                    examinationFindings: dto.examinationFindings,
                    clinicalNotes: dto.clinicalNotes,
                    examinedAt,
                },
                update: {
                    doctorId: doctor.doctorId,
                    examinationFindings: dto.examinationFindings,
                    clinicalNotes: dto.clinicalNotes,
                    examinedAt,
                },
                include: { doctor: true },
            });

            if (encounter.status === EncounterStatus.WAITING_FOR_DOCTOR) {
                await tx.encounter.update({
                    where: { encounterId },
                    data: { status: EncounterStatus.IN_PROGRESS },
                });
            }

            return examination;
        });
    }

    async findByEncounterId(encounterId: string) {
        const examination = await this.prisma.clinicalExamination.findUnique({
            where: { encounterId },
            include: { doctor: true },
        });

        if (!examination) {
            throw new NotFoundException(`Lượt khám ${encounterId} chưa có bản ghi khám lâm sàng`);
        }

        return examination;
    }
}
