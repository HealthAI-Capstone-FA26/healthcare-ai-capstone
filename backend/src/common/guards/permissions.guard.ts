import {
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    InternalServerErrorException,
    Injectable,
    UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import {
    isPermissionCode,
    PermissionCode,
    Scope,
} from '../constants/permissions.dictionary';

// Thứ tự scope: scope càng rộng thì rank càng cao -> tự thoả mãn scope hẹp hơn
const SCOPE_RANK: Record<Scope, number> = {
    [Scope.OWN]: 1,
    [Scope.GROUP]: 2,
    [Scope.ALL]: 3,
};

interface RequestUser {
    userId: string;
    email: string;
    permissions: string[];
}

@Injectable()
export class PermissionsGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        const requiredPermissions = this.reflector.getAllAndOverride<PermissionCode[]>(
            PERMISSIONS_KEY,
            [context.getHandler(), context.getClass()],
        );

        // Route không gắn @RequirePermissions -> cho qua
        if (!requiredPermissions || requiredPermissions.length === 0) {
            return true;
        }

        const invalidRequiredPermissions = requiredPermissions.filter(
            (code) => !isPermissionCode(code),
        );

        if (invalidRequiredPermissions.length > 0) {
            throw new InternalServerErrorException(
                `Permission metadata không hợp lệ: ${invalidRequiredPermissions.join(', ')}`,
            );
        }

        const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
        const user = request.user;

        if (!user) {
            throw new UnauthorizedException('Chưa xác thực người dùng');
        }

        const userPermissions = new Set(user.permissions ?? []);

        const hasPermission = requiredPermissions.every((required) =>
            this.matchPermission(required, userPermissions),
        );

        if (!hasPermission) {
            throw new ForbiddenException('Bạn không có quyền thực hiện hành động này');
        }

        return true;
    }

    /**
     * User có scope rộng hơn vẫn thoả mãn requirement scope hẹp hơn.
     * VD: user có 'patient:read:all' thì vẫn pass route yêu cầu 'patient:read:own'.
     */
    private matchPermission(
        required: PermissionCode,
        userPermissions: Set<string>,
    ): boolean {
        if (userPermissions.has(required)) {
            return true;
        }

        const [resource, action, scope] = required.split(':') as [string, string, Scope];
        const requiredRank = SCOPE_RANK[scope] ?? 0;

        for (const code of userPermissions) {
            if (!isPermissionCode(code)) {
                continue;
            }

            const [uResource, uAction, uScope] = code.split(':');
            if (uResource === resource && uAction === action) {
                const userRank = SCOPE_RANK[uScope] ?? 0;
                if (userRank >= requiredRank) {
                    return true;
                }
            }
        }

        return false;
    }
}
