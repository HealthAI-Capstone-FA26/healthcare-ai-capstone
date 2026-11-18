import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AssignLabStaffToRoomDto } from './dtos/assign-lab-staff-to-room.dto';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { ActorRoleService } from '../../identity-access/user/actor-role.service';

/** Không trả password hash / trường nhạy cảm của User ra API phân công. */
const SAFE_USER_SELECT = {
    userId: true,
    email: true,
    profile: { select: { fullName: true } },
} as const;

/**
 * SE04 — Danh mục phòng cận lâm sàng (Blood Lab / ECG / Echo / X-ray) và phân quyền kỹ thuật viên theo phòng.
 * Dùng để dựng worklist theo phòng và kiểm tra KTV có được thao tác DiagnosticTask thuộc phòng đó hay không.
 */
@Injectable()
export class LabRoomService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
    ) {}

    async listActive(modality?: string) {
        return this.prisma.diagnosticRoom.findMany({
            where: { isActive: true, ...(modality ? { modality } : {}) },
            orderBy: [{ modality: 'asc' }, { diagnosticRoomName: 'asc' }],
        });
    }

    async listStaffAssignments(diagnosticRoomId: string) {
        return this.prisma.diagnosticStaffRoomAssignment.findMany({
            where: { diagnosticRoomId },
            include: { user: { select: SAFE_USER_SELECT } },
        });
    }

    async listMyAssignments(userId: string) {
        return this.prisma.diagnosticStaffRoomAssignment.findMany({
            where: { userId },
            include: { diagnosticRoom: true },
            orderBy: [{ isPrimary: 'desc' }, { assignedAt: 'asc' }],
        });
    }

    /**
     * Phân công 1 kỹ thuật viên vào 1 phòng. Chỉ ADMIN được gọi. Idempotent (upsert theo khoá phức hợp
     * userId + diagnosticRoomId). Người được gán phải có vai trò LAB_STAFF (kỹ thuật viên cận lâm sàng).
     */
    async assignStaff(diagnosticRoomId: string, dto: AssignLabStaffToRoomDto, actingUserId: string) {
        await this.actorRoleService.assertActorRole(actingUserId, [ACTOR_ROLE.ADMIN]);

        const room = await this.prisma.diagnosticRoom.findUnique({ where: { diagnosticRoomId } });
        if (!room) {
            throw new NotFoundException(`Không tìm thấy phòng cận lâm sàng ${diagnosticRoomId}`);
        }

        try {
            await this.actorRoleService.assertActorRole(dto.userId, [ACTOR_ROLE.LAB_STAFF]);
        } catch (err) {
            if (err instanceof NotFoundException) throw err;
            throw new BadRequestException((err as Error).message);
        }

        return this.prisma.diagnosticStaffRoomAssignment.upsert({
            where: { userId_diagnosticRoomId: { userId: dto.userId, diagnosticRoomId } },
            create: { userId: dto.userId, diagnosticRoomId, isPrimary: dto.isPrimary ?? true },
            update: { isPrimary: dto.isPrimary ?? true },
            include: { user: { select: SAFE_USER_SELECT }, diagnosticRoom: true },
        });
    }

    /** Gỡ 1 kỹ thuật viên khỏi phòng (thu hồi quyền thao tác nhiệm vụ của phòng đó). Chỉ ADMIN. */
    async removeStaff(diagnosticRoomId: string, userId: string, actingUserId: string) {
        await this.actorRoleService.assertActorRole(actingUserId, [ACTOR_ROLE.ADMIN]);

        const existing = await this.prisma.diagnosticStaffRoomAssignment.findUnique({
            where: { userId_diagnosticRoomId: { userId, diagnosticRoomId } },
        });
        if (!existing) {
            throw new NotFoundException(`Kỹ thuật viên ${userId} chưa được phân công vào phòng ${diagnosticRoomId}`);
        }

        await this.prisma.diagnosticStaffRoomAssignment.delete({
            where: { userId_diagnosticRoomId: { userId, diagnosticRoomId } },
        });
        return { diagnosticRoomId, userId, removed: true };
    }

    /** Guard nghiệp vụ ở LabTaskService: KTV có được phân công vào phòng của nhiệm vụ hay không. */
    async isStaffAssignedToRoom(userId: string, diagnosticRoomId: string): Promise<boolean> {
        const assignment = await this.prisma.diagnosticStaffRoomAssignment.findUnique({
            where: { userId_diagnosticRoomId: { userId, diagnosticRoomId } },
        });
        return !!assignment;
    }
}
