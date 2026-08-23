import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
// Sửa lại 2 path dưới đây cho khớp vị trí thật trong project
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { Action, PermissionCode, Resource, Scope } from '../constants/permissions.dictionary';
import { hasPermissionScope } from '../utils/permission.util';
import { RequestUser } from '../../modules/auth/strategies/jwt.strategy';

/**
 * Guard kiểm tra RBAC theo permission code (resource:action:scope).
 * PHẢI chạy SAU JwtAuthGuard (JwtAuthGuard gắn req.user, gồm req.user.permissions).
 *
 * Dùng: @UseGuards(JwtAuthGuard, PermissionsGuard)
 *       @RequirePermissions('role:update:all')
 *
 * So khớp theo RANK scope (dùng chung hasPermissionScope với service layer), không phải
 * exact-match chuỗi: user có scope rộng hơn route yêu cầu vẫn qua được, vd route yêu cầu
 * `patient:read:own` thì user có `patient:read:group` hoặc `patient:read:all` đều pass.
 * User cần thoả ĐỦ TẤT CẢ permission được liệt kê (AND logic).
 * Nếu route không gắn @RequirePermissions(...) thì coi như không giới hạn
 * (chỉ cần đã đăng nhập là qua được guard này).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const requiredPermissions = this.reflector.getAllAndOverride<
            PermissionCode[]
        >(PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

        if (!requiredPermissions || requiredPermissions.length === 0) {
            return true;
        }

        const request = context.switchToHttp().getRequest();
        const user: RequestUser | undefined = request.user;

        if (!user) {
            // Không có user nghĩa là JwtAuthGuard chưa chạy trước PermissionsGuard
            throw new ForbiddenException('Không xác định được người dùng');
        }

        const hasAllRequiredPermissions = requiredPermissions.every((perm) => {
            const [resource, action, scope] = perm.split(':') as [Resource, Action, Scope];
            return hasPermissionScope(user.permissions, resource, action, scope);
        });

        if (!hasAllRequiredPermissions) {
            throw new ForbiddenException(
                `Yêu cầu quyền: ${requiredPermissions.join(', ')}`,
            );
        }

        return true;
    }
}