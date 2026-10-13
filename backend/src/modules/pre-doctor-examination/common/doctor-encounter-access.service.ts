import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Encounter, Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ActorRoleService } from '../../user/actor-role.service';
import { DoctorService } from '../../doctor/doctor.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { EncounterStatus } from '../../../common/utils/encounter-status.util';
import { DoctorQueueStatus } from '../../../common/constants/doctor-queue.constants';
import { assertEncounterStatusIn } from './encounter-status.guard';

/**
 * Điểm kiểm soát DUY NHẤT cho mọi thao tác GHI của bác sĩ trong SE02 (khám lâm sàng, chẩn đoán, chỉ định):
 *   1. actorRole phải là DOCTOR và có hồ sơ Doctor;
 *   2. Encounter tồn tại và đang ở trạng thái cho phép;
 *   3. đúng bác sĩ phụ trách (Encounter.doctorId do routing gán) — bác sĩ khác không được ghi đè hồ sơ.
 * Đồng thời gom logic "bắt đầu khám" (waiting_for_doctor -> in_progress + đồng bộ DoctorQueueEntry).
 */
@Injectable()
export class DoctorEncounterAccessService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
        private readonly doctorService: DoctorService,
    ) {}

    async prepareWrite(encounterId: string, userId: string, allowedStatuses: string[], action: string) {
        await this.actorRoleService.assertActorRole(userId, [ACTOR_ROLE.DOCTOR]);
        const doctor = await this.doctorService.findByUserId(userId);

        const encounter = await this.prisma.encounter.findUnique({ where: { encounterId } });
        if (!encounter) {
            throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
        }
        assertEncounterStatusIn(encounter.status, allowedStatuses, action);
        this.assertOwnedBy(encounter, doctor.doctorId);

        return { doctor, encounter };
    }

    assertOwnedBy(encounter: Pick<Encounter, 'doctorId' | 'encounterId'>, doctorId: string): void {
        if (encounter.doctorId && encounter.doctorId !== doctorId) {
            throw new ForbiddenException('Lượt khám này thuộc bác sĩ khác phụ trách, bạn không thể ghi nhận/chỉnh sửa.');
        }
    }

    /**
     * Bác sĩ bắt đầu khám. Idempotent và an toàn khi 2 request đồng thời (updateMany có điều kiện status):
     *  - Encounter waiting_for_doctor -> in_progress; gán doctorId nếu còn trống;
     *  - DoctorQueueEntry waiting|called -> in_progress, ghi examStartedAt.
     * Trả về true nếu lần gọi này thực sự chuyển trạng thái.
     */
    async startExaminationIfNeeded(
        tx: Prisma.TransactionClient,
        encounter: Pick<Encounter, 'encounterId' | 'status' | 'doctorId'>,
        doctorId: string,
    ): Promise<boolean> {
        const { encounterId } = encounter;

        if (encounter.status !== EncounterStatus.WAITING_FOR_DOCTOR) {
            if (!encounter.doctorId) {
                await tx.encounter.updateMany({ where: { encounterId, doctorId: null }, data: { doctorId } });
            }
            return false;
        }

        const moved = await tx.encounter.updateMany({
            where: { encounterId, status: EncounterStatus.WAITING_FOR_DOCTOR },
            data: { status: EncounterStatus.IN_PROGRESS, ...(encounter.doctorId ? {} : { doctorId }) },
        });
        if (moved.count === 0) return false;

        await tx.doctorQueueEntry.updateMany({
            where: { encounterId, status: { in: [DoctorQueueStatus.WAITING, DoctorQueueStatus.CALLED] } },
            data: { status: DoctorQueueStatus.IN_PROGRESS, examStartedAt: new Date() },
        });
        return true;
    }
}
