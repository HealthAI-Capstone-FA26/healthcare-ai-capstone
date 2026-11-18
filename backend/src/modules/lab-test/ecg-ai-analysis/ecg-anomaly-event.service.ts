import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ActorRoleService } from '../../identity-access/user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { ListEcgEventsQueryDto } from './dto/list-ecg-events-query.dto';
import { ReviewEcgEventDto } from './dto/review-ecg-event.dto';

const EVENT_INCLUDE = {
    analysis: {
        select: {
            analysisId: true,
            ecgRecordingId: true,
            analysisMode: true,
            overallResult: true,
            isCurrent: true,
            modelVersion: { select: { modelName: true, version: true } },
        },
    },
} as const;

/**
 * SE04 — Sự kiện bất thường ECG (EcgAnomalyEvent) = cảnh báo realtime của AI. HAI vòng đời ĐỘC LẬP (đúng schema):
 *   - alertStatus   : active -> acknowledged -> resolved   (xử lý cảnh báo; auto_dismissed dành cho hệ thống)
 *   - reviewVerdict : pending -> true_positive | false_positive | uncertain   (bác sĩ xác nhận AI đúng/sai)
 * Xác nhận "false_positive" KHÔNG tự đóng cảnh báo — hai việc do người dùng quyết định riêng.
 * Đổi trạng thái bằng updateMany có điều kiện (compare-and-swap) để thao tác đồng thời không ghi đè nhau.
 */
@Injectable()
export class EcgAnomalyEventService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
    ) {}

    /** Feed cảnh báo theo lượt khám (mới nhất trước). Mặc định chỉ lấy sự kiện của analysis hiện hành (isCurrent). */
    async listByEncounter(encounterId: string, query: ListEcgEventsQueryDto) {
        return this.prisma.ecgAnomalyEvent.findMany({
            where: {
                analysis: { ecgRecording: { encounterId }, isCurrent: true },
                ...(query.alertStatus ? { alertStatus: query.alertStatus } : {}),
                ...(query.severity ? { severity: query.severity } : {}),
                ...(query.reviewVerdict ? { reviewVerdict: query.reviewVerdict } : {}),
            },
            orderBy: [{ createdAt: 'desc' }, { startOffsetMs: 'asc' }],
            include: EVENT_INCLUDE,
        });
    }

    async acknowledge(eventId: string, userId: string) {
        await this.actorRoleService.assertActorRole(userId, [ACTOR_ROLE.DOCTOR, ACTOR_ROLE.LAB_STAFF]);

        const changed = await this.prisma.ecgAnomalyEvent.updateMany({
            where: { eventId, alertStatus: 'active' },
            data: { alertStatus: 'acknowledged', acknowledgedByUserId: userId, acknowledgedAt: new Date() },
        });
        if (changed.count === 0) await this.throwTransitionError(eventId, "xác nhận đã nhận (chỉ từ 'active')");
        return this.getById(eventId);
    }

    async resolve(eventId: string, userId: string) {
        await this.actorRoleService.assertActorRole(userId, [ACTOR_ROLE.DOCTOR, ACTOR_ROLE.LAB_STAFF]);

        const changed = await this.prisma.ecgAnomalyEvent.updateMany({
            where: { eventId, alertStatus: { in: ['active', 'acknowledged'] } },
            data: { alertStatus: 'resolved' },
        });
        if (changed.count === 0) await this.throwTransitionError(eventId, "đóng cảnh báo (chỉ từ 'active' hoặc 'acknowledged')");
        return this.getById(eventId);
    }

    /** Bác sĩ đánh giá AI đúng/sai. Cho phép đổi ý (ghi đè), nên chỉ cần sự kiện tồn tại. Chỉ DOCTOR. */
    async review(eventId: string, dto: ReviewEcgEventDto, userId: string) {
        await this.actorRoleService.assertActorRole(userId, [ACTOR_ROLE.DOCTOR]);

        const changed = await this.prisma.ecgAnomalyEvent.updateMany({
            where: { eventId },
            data: { reviewVerdict: dto.verdict, reviewedByUserId: userId, reviewedAt: new Date(), reviewNote: dto.note ?? null },
        });
        if (changed.count === 0) throw new NotFoundException(`Không tìm thấy sự kiện ECG ${eventId}`);
        return this.getById(eventId);
    }

    async getById(eventId: string) {
        const event = await this.prisma.ecgAnomalyEvent.findUnique({ where: { eventId }, include: EVENT_INCLUDE });
        if (!event) throw new NotFoundException(`Không tìm thấy sự kiện ECG ${eventId}`);
        return event;
    }

    private async throwTransitionError(eventId: string, action: string): Promise<never> {
        const event = await this.prisma.ecgAnomalyEvent.findUnique({ where: { eventId }, select: { alertStatus: true } });
        if (!event) throw new NotFoundException(`Không tìm thấy sự kiện ECG ${eventId}`);
        throw new ConflictException(`Không thể ${action}: cảnh báo đang ở trạng thái '${event.alertStatus}'.`);
    }
}
