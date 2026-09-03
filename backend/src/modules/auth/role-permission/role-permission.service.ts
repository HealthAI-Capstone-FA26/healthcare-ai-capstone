import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

@Injectable()
export class AdminRbacService {
    constructor(private readonly prisma: PrismaService) { }

    // ============================================================
    // ROLE <-> PERMISSION
    // ============================================================

    /** Lấy danh sách tất cả permissions khả dụng trong hệ thống */
    async listAllPermissions() {
        return this.prisma.permission.findMany({
            orderBy: { permissionCode: 'asc' },
        });
    }

    /** Lấy danh sách tất cả role kèm permissions (cho màn hình quản trị) */
    async listRolesWithPermissions() {
        const roles = await this.prisma.role.findMany({
            include: {
                rolePermissions: {
                    include: { permission: true },
                },
            },
            orderBy: { roleName: 'asc' },
        });

        return roles.map((r) => ({
            ...r,
            roleCode: r.roleCode.trim(),
        }));
    }

    /** Lấy permissions hiện tại của 1 role */
    async getRolePermissions(roleId: string) {
        const role = await this.prisma.role.findUnique({
            where: { roleId },
            include: {
                rolePermissions: { include: { permission: true } },
            },
        });

        if (!role) {
            throw new NotFoundException(`Không tìm thấy role với id ${roleId}`);
        }

        return role.rolePermissions.map((rp) => rp.permission);
    }

    /**
     * Thêm (gán) một tập permission vào role, giữ nguyên các permission cũ.
     * Bỏ qua permission nào đã tồn tại trong role (skipDuplicates).
     */
    async addPermissionsToRole(roleId: string, permissionIds: string[]) {
        await this.ensureRoleExists(roleId);
        await this.ensurePermissionsExist(permissionIds);

        await this.prisma.rolePermission.createMany({
            data: permissionIds.map((permissionId) => ({
                roleId,
                permissionId,
            })),
            skipDuplicates: true,
        });

        return this.getRolePermissions(roleId);
    }

    /**
     * Set lại toàn bộ danh sách permission của role (thay thế hoàn toàn).
     * Chạy trong transaction để đảm bảo tính nhất quán.
     */
    async replaceRolePermissions(roleId: string, permissionIds: string[]) {
        await this.ensureRoleExists(roleId);
        await this.ensurePermissionsExist(permissionIds);

        await this.prisma.$transaction([
            this.prisma.rolePermission.deleteMany({ where: { roleId } }),
            this.prisma.rolePermission.createMany({
                data: permissionIds.map((permissionId) => ({
                    roleId,
                    permissionId,
                })),
                skipDuplicates: true,
            }),
        ]);

        return this.getRolePermissions(roleId);
    }

    /** Gỡ 1 permission khỏi role */
    async removePermissionFromRole(roleId: string, permissionId: string) {
        await this.ensureRoleExists(roleId);

        const existing = await this.prisma.rolePermission.findUnique({
            where: { roleId_permissionId: { roleId, permissionId } },
        });

        if (!existing) {
            throw new NotFoundException(
                `Role ${roleId} hiện không có permission ${permissionId}`,
            );
        }

        await this.prisma.rolePermission.delete({
            where: { roleId_permissionId: { roleId, permissionId } },
        });

        return this.getRolePermissions(roleId);
    }

    // ============================================================
    // USER <-> ROLE  (ràng buộc nghiệp vụ: 1 user chỉ có 1 role tại 1 thời điểm)
    // ============================================================

    /** Lấy role hiện tại của user (null nếu chưa được gán role nào) */
    async getUserRole(userId: string) {
        const user = await this.prisma.user.findUnique({
            where: { userId },
            include: {
                userRoles: { include: { role: true } },
            },
        });

        if (!user) {
            throw new NotFoundException(`Không tìm thấy user với id ${userId}`);
        }

        return user.userRoles[0]?.role ?? null;
    }

    /**
     * Gán role cho user. Vì 1 user chỉ có 1 role nên thao tác này sẽ
     * THAY THẾ role cũ (nếu có) bằng role mới, đồng thời đồng bộ
     * UserProfile.actorRole = Role.roleCode của role vừa gán.
     * Toàn bộ chạy trong 1 transaction để đảm bảo nhất quán.
     */
    async assignRoleToUser(userId: string, roleId: string, assignedBy: string) {
        const user = await this.prisma.user.findUnique({
            where: { userId },
            include: { profile: true, userRoles: true },
        });

        if (!user) {
            throw new NotFoundException(`Không tìm thấy user với id ${userId}`);
        }

        const role = await this.ensureRoleExists(roleId);

        const alreadyHasThisRole = user.userRoles.some(
            (userRole) => userRole.roleId === roleId,
        );
        if (alreadyHasThisRole) {
            return role;
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.userRole.deleteMany({ where: { userId } });

            await tx.userRole.create({
                data: { userId, roleId, assignedBy },
            });

            if (user.profile) {
                await tx.userProfile.update({
                    where: { userId },
                    data: { actorRole: role.roleCode },
                });
            }
        });

        return role;
    }


    // ============================================================
    // HELPERS
    // ============================================================

    private async ensureRoleExists(roleId: string) {
        const role = await this.prisma.role.findUnique({ where: { roleId } });
        if (!role) {
            throw new NotFoundException(`Không tìm thấy role với id ${roleId}`);
        }
        return role;
    }

    private async ensureUserExists(userId: string) {
        const user = await this.prisma.user.findUnique({ where: { userId } });
        if (!user) {
            throw new NotFoundException(`Không tìm thấy user với id ${userId}`);
        }
        return user;
    }

    private async ensurePermissionsExist(permissionIds: string[]) {
        const found = await this.prisma.permission.findMany({
            where: { permissionId: { in: permissionIds } },
            select: { permissionId: true },
        });

        if (found.length !== permissionIds.length) {
            const foundIds = new Set(found.map((p) => p.permissionId));
            const missing = permissionIds.filter((id) => !foundIds.has(id));
            throw new NotFoundException(
                `Không tìm thấy permission(s): ${missing.join(', ')}`,
            );
        }
    }
}