import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ActorRole, normalizeActorRole } from '../../common/constants/actor-role.constant';

/**
 * Nguồn tra cứu actorRole DUY NHẤT mà các module khác (lab-test, vitals, pre-doctor-examination...) dùng
 * khi cần biết "user này đang đóng vai trò gì" trước khi thao tác nghiệp vụ.
 *
 * Schema v2: mỗi User có đúng 1 Role (User.roleId -> Role.roleCode). UserRole / UserProfile.actorRole đã bị
 * loại bỏ, nên đọc thẳng `user.role.roleCode` rồi chuẩn hoá (cardiologist -> DOCTOR, diagnostic_tech -> LAB_STAFF...).
 */
@Injectable()
export class ActorRoleService {
    constructor(private readonly prisma: PrismaService) {}

    /** Trả về actorRole hiện tại của user. Throws NotFoundException nếu user không tồn tại. */
    async getActorRole(userId: string): Promise<ActorRole> {
        const user = await this.prisma.user.findUnique({
            where: { userId },
            select: { role: { select: { roleCode: true } } },
        });

        if (!user) {
            throw new NotFoundException(`Không tìm thấy user ${userId}`);
        }

        const actorRole = normalizeActorRole(user.role?.roleCode);
        if (!actorRole) {
            throw new ForbiddenException(
                `roleCode '${user.role?.roleCode ?? ''}' của user ${userId} không map được sang actorRole hợp lệ.`,
            );
        }
        return actorRole;
    }

    /** Đảm bảo actorRole của user nằm trong danh sách cho phép; trả về actorRole nếu hợp lệ. */
    async assertActorRole(userId: string, allowed: ActorRole[]): Promise<ActorRole> {
        const actorRole = await this.getActorRole(userId);
        if (!allowed.includes(actorRole)) {
            throw new ForbiddenException(
                `User ${userId} có actorRole '${actorRole}', yêu cầu một trong: ${allowed.join(', ')}.`,
            );
        }
        return actorRole;
    }
}
