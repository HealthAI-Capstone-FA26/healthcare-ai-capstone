import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ActorRoleService } from '../../identity-access/user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { LabResultDetectionOrchestrator } from './orchestrators/lab-result-detection.orchestrator';

export const ALERT_STATUSES = ['active', 'confirmed', 'resolved'] as const;

const ALERT_INCLUDE = {
    resultValue: {
        include: {
            parameter: { select: { parameterCode: true, parameterName: true, unit: true } },
            result: { select: { resultId: true, taskId: true } },
        },
    },
} as const;

/**
 * SE04 — Vòng đời ResultValueAlert (cảnh báo chỉ số nguy hiểm): active -> confirmed -> resolved.
 *  - confirm : bác sĩ/KTV xác nhận đã nhìn thấy (ghi confirmedByUserId/At). Chỉ từ 'active'.
 *  - resolve : đã xử lý xong. Từ 'active' hoặc 'confirmed'. (Hệ thống cũng tự 'resolved' khi kết quả được đính chính
 *              và chỉ số hết bất thường — xem LabResultDetectionOrchestrator.)
 * Đổi trạng thái dùng updateMany có điều kiện (compare-and-swap) để 2 người thao tác cùng lúc không ghi đè nhau.
 */
@Injectable()
export class LabResultAlertService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
        private readonly orchestrator: LabResultDetectionOrchestrator,
    ) {}

    /** Chạy lại detection thủ công cho 1 kết quả. */
    async detect(resultId: string, actingUserId: string) {
        await this.actorRoleService.assertActorRole(actingUserId, [ACTOR_ROLE.LAB_STAFF, ACTOR_ROLE.DOCTOR]);

        const exists = await this.prisma.diagnosticResult.findUnique({ where: { resultId }, select: { resultId: true } });
        if (!exists) {
            throw new NotFoundException(`Không tìm thấy kết quả ${resultId}`);
        }
        const { results } = await this.orchestrator.run(resultId);
        return results;
    }

    async listByEncounter(encounterId: string, status?: string) {
        if (status && !(ALERT_STATUSES as readonly string[]).includes(status)) {
            throw new BadRequestException(`status phải thuộc: ${ALERT_STATUSES.join(', ')}`);
        }
        return this.prisma.resultValueAlert.findMany({
            where: { encounterId, ...(status ? { status } : {}) },
            orderBy: { createdAt: 'desc' },
            include: ALERT_INCLUDE,
        });
    }

    async confirm(alertId: string, actingUserId: string) {
        await this.actorRoleService.assertActorRole(actingUserId, [ACTOR_ROLE.DOCTOR, ACTOR_ROLE.LAB_STAFF]);

        const changed = await this.prisma.resultValueAlert.updateMany({
            where: { alertId, status: 'active' },
            data: { status: 'confirmed', confirmedByUserId: actingUserId, confirmedAt: new Date() },
        });
        if (changed.count === 0) await this.throwTransitionError(alertId, "xác nhận (chỉ từ 'active')");
        return this.prisma.resultValueAlert.findUniqueOrThrow({ where: { alertId }, include: ALERT_INCLUDE });
    }

    async resolve(alertId: string, actingUserId: string) {
        await this.actorRoleService.assertActorRole(actingUserId, [ACTOR_ROLE.DOCTOR, ACTOR_ROLE.LAB_STAFF]);

        const changed = await this.prisma.resultValueAlert.updateMany({
            where: { alertId, status: { in: ['active', 'confirmed'] } },
            data: { status: 'resolved' },
        });
        if (changed.count === 0) await this.throwTransitionError(alertId, "giải quyết (chỉ từ 'active' hoặc 'confirmed')");
        return this.prisma.resultValueAlert.findUniqueOrThrow({ where: { alertId }, include: ALERT_INCLUDE });
    }

    private async throwTransitionError(alertId: string, action: string): Promise<never> {
        const alert = await this.prisma.resultValueAlert.findUnique({ where: { alertId }, select: { status: true } });
        if (!alert) throw new NotFoundException(`Không tìm thấy cảnh báo ${alertId}`);
        throw new ConflictException(`Không thể ${action}: cảnh báo đang ở trạng thái '${alert.status}'.`);
    }
}
