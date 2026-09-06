/**
 * TỪ NAY: mọi nơi gán/so sánh actorRole PHẢI dùng hằng số ở đây — không hardcode string nữa.
 * Muốn kiểm tra actorRole của 1 user theo userId, dùng ActorRoleService
 * (src/modules/user/actor-role.service.ts) thay vì tự query rải rác.
 */
export const ACTOR_ROLE = {
    PATIENT: 'PATIENT',
    RECEPTIONIST: 'RECEPTIONIST',
    NURSE: 'NURSE',
    DOCTOR: 'DOCTOR',
    LAB_STAFF: 'LAB_STAFF',
    ADMIN: 'ADMIN',
} as const;

export type ActorRole = (typeof ACTOR_ROLE)[keyof typeof ACTOR_ROLE];

export const ACTOR_ROLE_VALUES: ActorRole[] = Object.values(ACTOR_ROLE) as ActorRole[];

export function isValidActorRole(value: string): value is ActorRole {
    return (ACTOR_ROLE_VALUES as string[]).includes(value);
}
