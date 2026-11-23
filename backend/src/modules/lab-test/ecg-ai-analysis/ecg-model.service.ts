import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ActorRoleService } from '../../identity-access/user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { toNumber } from './ecg-response.mapper';

export const ECG_AI_TASK_TYPE = 'ecg_anomaly_detection';

/**
 * Danh mục model AI ECG cho màn "Chạy lại phân tích" (chọn modelVersionId + ngưỡng mặc định).
 * Chỉ trả model dùng được cho reanalysis: 'active' | 'candidate' (khớp điều kiện của EcgAnalysisService.enqueue).
 * Không lộ artifactUrl (đường dẫn nội bộ checkpoint).
 */
@Injectable()
export class EcgModelService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
    ) {}

    async listSelectable(userId: string) {
        await this.actorRoleService.assertActorRole(userId, [ACTOR_ROLE.LAB_STAFF, ACTOR_ROLE.DOCTOR, ACTOR_ROLE.ADMIN]);

        const models = await this.prisma.aiModelVersion.findMany({
            where: { taskType: ECG_AI_TASK_TYPE, status: { in: ['active', 'candidate'] } },
            orderBy: [{ deployedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
            select: {
                modelVersionId: true,
                modelName: true,
                version: true,
                status: true,
                architecture: true,
                inputSpec: true,
                defaultThreshold: true,
                evaluationMetrics: true,
                deployedAt: true,
            },
        });

        // Model 'active' mới nhất là mặc định của enqueue() khi không truyền modelVersionId.
        const defaultId = models.find((m) => m.status === 'active')?.modelVersionId ?? null;
        return models.map((m) => ({
            ...m,
            defaultThreshold: toNumber(m.defaultThreshold),
            isDefault: m.modelVersionId === defaultId,
            label: `${m.modelName} v${m.version}${m.status === 'candidate' ? ' (thử nghiệm)' : ''}`,
        }));
    }
}
