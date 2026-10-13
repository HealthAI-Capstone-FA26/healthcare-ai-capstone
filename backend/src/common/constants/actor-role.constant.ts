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

/**
 * Schema v2: User có đúng 1 Role (User.roleId) và Role.roleCode viết thường theo nghiệp vụ
 * (patient | receptionist | nurse | cardiologist | diagnostic_tech | cashier | admin).
 * Hàm này chuẩn hoá roleCode (hoa/thường, tên mới/cũ) về ActorRole dùng trong code.
 * Trả về null nếu không map được (để caller quyết định ném lỗi).
 */
const ROLE_CODE_ALIASES: Record<string, ActorRole> = {
    PATIENT: ACTOR_ROLE.PATIENT,
    RECEPTIONIST: ACTOR_ROLE.RECEPTIONIST,
    NURSE: ACTOR_ROLE.NURSE,
    DOCTOR: ACTOR_ROLE.DOCTOR,
    CARDIOLOGIST: ACTOR_ROLE.DOCTOR,
    LAB_STAFF: ACTOR_ROLE.LAB_STAFF,
    DIAGNOSTIC_TECH: ACTOR_ROLE.LAB_STAFF,
    ADMIN: ACTOR_ROLE.ADMIN,
};

export function normalizeActorRole(roleCode: string | null | undefined): ActorRole | null {
    if (!roleCode) return null;
    return ROLE_CODE_ALIASES[roleCode.trim().toUpperCase()] ?? null;
}


/**
 * Role.roleCode (schema v2) tương ứng với từng ActorRole — dùng khi cần LỌC / TÌM Role theo actorRole
 * (vd: tạo bác sĩ -> gán role 'cardiologist', lọc danh sách user theo actorRole).
 */
export function roleCodesOfActorRole(actorRole: string): string[] {
    const target = actorRole.trim().toUpperCase();
    return Object.entries(ROLE_CODE_ALIASES)
        .filter(([, mapped]) => mapped === target)
        .map(([code]) => code.toLowerCase());
}

/** roleCode "chính" (viết thường theo schema v2) của 1 ActorRole để tìm/gán Role. */
export const PRIMARY_ROLE_CODE: Record<ActorRole, string> = {
    PATIENT: 'patient',
    RECEPTIONIST: 'receptionist',
    NURSE: 'nurse',
    DOCTOR: 'cardiologist',
    LAB_STAFF: 'diagnostic_tech',
    ADMIN: 'admin',
};
