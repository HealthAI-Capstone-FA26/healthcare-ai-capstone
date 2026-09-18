import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AssignLabStaffToRoomDto } from './dtos/assign-lab-staff-to-room.dto';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { ActorRoleService } from '../../user/actor-role.service';

/**
 * Danh mục phòng Lab (Huyết học, Sinh hoá, Chẩn đoán hình ảnh, ...) và phân quyền
 * kỹ thuật viên theo từng phòng — dùng để dựng worklist theo phòng và kiểm tra
 * kỹ thuật viên có được phép thao tác trên 1 LabTask thuộc phòng đó hay không.
 */
@Injectable()
export class LabRoomService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
    ) { }

    async listActive() {
        return this.prisma.labRoom.findMany({
            where: { isActive: true },
            orderBy: { labRoomName: 'asc' },
        });
    }

    async listStaffAssignments(labRoomId: string) {
        return this.prisma.labStaffRoomAssignment.findMany({
            where: { labRoomId },
            include: { user: true },
        });
    }

    async listMyAssignments(userId: string) {
        return this.prisma.labStaffRoomAssignment.findMany({
            where: { userId },
            include: {
                labRoom: true,
            },
            orderBy: [{ isPrimary: 'desc' }, { assignedAt: 'asc' }],
        });
    }

    /**
     * Phân công 1 kỹ thuật viên vào 1 phòng Lab. Idempotent (upsert theo khoá phức hợp
     * userId+labRoomId) — gọi lại với isPrimary khác sẽ cập nhật thay vì báo lỗi trùng.
     *
     * Kiểm tra 2 điều kiện trước khi gán:
     *  1. Phòng Lab tồn tại.
     *  2. actorRole của user (tra qua ActorRoleService — nguồn DUY NHẤT, đọc thẳng
     *     UserProfile.actorRole) phải là ACTOR_ROLE.LAB_STAFF — tránh gán nhầm
     *     bác sĩ/điều dưỡng/lễ tân... vào danh sách kỹ thuật viên của phòng.
     */
    async assignStaff(labRoomId: string, dto: AssignLabStaffToRoomDto) {
        const labRoom = await this.prisma.labRoom.findUnique({ where: { labRoomId } });
        if (!labRoom) {
            throw new NotFoundException(`Không tìm thấy phòng Lab ${labRoomId}`);
        }

        // nếu actorRole không phải LAB_STAFF.
        try {
            await this.actorRoleService.assertActorRole(dto.userId, [ACTOR_ROLE.LAB_STAFF]);
        } catch (err) {
            if (err instanceof NotFoundException) throw err;
            throw new BadRequestException((err as Error).message);
        }

        return this.prisma.labStaffRoomAssignment.upsert({
            where: { userId_labRoomId: { userId: dto.userId, labRoomId } },
            create: {
                userId: dto.userId,
                labRoomId,
                isPrimary: dto.isPrimary ?? true,
            },
            update: {
                isPrimary: dto.isPrimary ?? true,
            },
            include: { user: true, labRoom: true },
        });
    }

    /** Gỡ 1 kỹ thuật viên khỏi phòng Lab (thu hồi quyền thao tác nhiệm vụ của phòng đó). */
    async removeStaff(labRoomId: string, userId: string) {
        const existing = await this.prisma.labStaffRoomAssignment.findUnique({
            where: { userId_labRoomId: { userId, labRoomId } },
        });
        if (!existing) {
            throw new NotFoundException(`Kỹ thuật viên ${userId} chưa được phân công vào phòng Lab ${labRoomId}`);
        }

        await this.prisma.labStaffRoomAssignment.delete({
            where: { userId_labRoomId: { userId, labRoomId } },
        });
        return { labRoomId, userId, removed: true };
    }

    /**
     * Kiểm tra 1 kỹ thuật viên có được phân công vào phòng Lab tương ứng hay không.
     * Dùng làm guard nghiệp vụ ở LabTaskService trước khi cho gán/nhận nhiệm vụ.
     */
    async isStaffAssignedToRoom(userId: string, labRoomId: string): Promise<boolean> {
        const assignment = await this.prisma.labStaffRoomAssignment.findUnique({
            where: { userId_labRoomId: { userId, labRoomId } },
        });
        return !!assignment;
    }
}
