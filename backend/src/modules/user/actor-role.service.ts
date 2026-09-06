import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { ActorRole, isValidActorRole } from '../../common/constants/actor-role.constant';

/**
 * Nguồn tra cứu actorRole DUY NHẤT mà các module khác (lab-test, vitals, ...) nên dùng
 * khi cần biết "user này đang đóng vai trò gì" trước khi assign/thao tác nghiệp vụ
 * (VD: chỉ cho gán LabStaffRoomAssignment nếu actorRole = LAB_STAFF).
 *
 * Đọc thẳng UserProfile.actorRole — field này giờ luôn được AdminRbacService.assignRoleToUser
 * đồng bộ (upsert) mỗi khi role của user thay đổi, nên KHÔNG cần tự join qua UserRole/Role
 * và làm fallback logic rải rác ở từng module nữa (xem actor-role.constant.ts để biết lịch sử
 * bug đã sửa: casing lệch 'patient' vs 'PATIENT', và Role.roleCode Char(36) bị pad khoảng trắng).
 *
 * Import UserModule (đã export service này) ở module cần dùng, rồi inject bình thường.
 */
@Injectable()
export class ActorRoleService {
    constructor(private readonly prisma: PrismaService) {}

    /** Trả về actorRole hiện tại của user. Throws NotFoundException nếu user chưa có UserProfile. */
    async getActorRole(userId: string): Promise<ActorRole> {
        const profile = await this.prisma.userProfile.findUnique({
            where: { userId },
            select: { actorRole: true },
        });

        if (!profile) {
            throw new NotFoundException(`Không tìm thấy hồ sơ (UserProfile) cho user ${userId}`);
        }

        const actorRole = profile.actorRole.trim();
        if (!isValidActorRole(actorRole)) {
            // Dữ liệu cũ/lỗi (VD: còn sót giá trị chưa chuẩn hoá trước khi có ACTOR_ROLE constant).
            // Ném lỗi rõ ràng thay vì âm thầm coi như hợp lệ, để phát hiện sớm thay vì assign nhầm người.
            throw new ForbiddenException(
                `actorRole '${actorRole}' của user ${userId} không thuộc danh sách hợp lệ. ` +
                    'Cần chuẩn hoá lại UserProfile.actorRole (xem migration 20260906120000_fix_role_code_varchar).',
            );
        }

        return actorRole;
    }

    /**
     * Đảm bảo user có actorRole nằm trong danh sách cho phép — dùng làm guard nghiệp vụ.
     * Throws ForbiddenException nếu không khớp. Trả về actorRole nếu hợp lệ (để dùng tiếp nếu cần).
     */
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
