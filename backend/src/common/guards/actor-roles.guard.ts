import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ActorRoleService } from '../../modules/identity-access/user/actor-role.service';
import { ACTOR_ROLES_KEY } from '../decorators/actor-roles.decorator';
import { ActorRole } from '../constants/actor-role.constant';

/**
 * Chặn theo actorRole (DOCTOR/NURSE/...) cho các endpoint đọc/ghi dữ liệu lâm sàng.
 * PHẢI chạy SAU JwtAuthGuard: @UseGuards(JwtAuthGuard, ActorRolesGuard) + @AllowActorRoles(...).
 * Route không gắn @AllowActorRoles thì không giới hạn thêm.
 */
@Injectable()
export class ActorRolesGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly actorRoleService: ActorRoleService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const allowed = this.reflector.getAllAndOverride<ActorRole[] | undefined>(ACTOR_ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (!allowed || allowed.length === 0) return true;

        const userId: string | undefined = context.switchToHttp().getRequest().user?.userId;
        if (!userId) throw new ForbiddenException('Không xác định được người dùng');

        await this.actorRoleService.assertActorRole(userId, allowed);
        return true;
    }
}
