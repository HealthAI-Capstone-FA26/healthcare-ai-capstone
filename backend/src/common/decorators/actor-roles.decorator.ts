import { SetMetadata } from '@nestjs/common';
import { ActorRole } from '../constants/actor-role.constant';

export const ACTOR_ROLES_KEY = 'actorRoles';

/** Giới hạn route/controller cho các actorRole được liệt kê. Dùng cùng ActorRolesGuard (sau JwtAuthGuard). */
export const AllowActorRoles = (...roles: ActorRole[]) => SetMetadata(ACTOR_ROLES_KEY, roles);
