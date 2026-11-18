import { Action, Resource, Scope } from '../constants/permissions.dictionary';

const SCOPE_RANK: Record<Scope, number> = {
  [Scope.OWN]: 1,
  [Scope.GROUP]: 2,
  [Scope.ALL]: 3,
};

/**
 * Trả về true nếu user (theo danh sách permission code) có quyền `${resource}:${action}`
 * ở scope >= scope truyền vào (scope rộng hơn tự thoả mãn scope hẹp hơn).
 * Dùng khi service cần rẽ nhánh nghiệp vụ theo scope, không chỉ chặn/cho ở tầng guard.
 */
export function hasPermissionScope(
  userPermissions: string[] | undefined,
  resource: Resource,
  action: Action,
  minScope: Scope = Scope.OWN,
): boolean {
  if (!userPermissions?.length) return false;

  const requiredRank = SCOPE_RANK[minScope];// đặt là minsScope

  return userPermissions.some((code) => {
    const [r, a, s] = code.split(':');
    return r === resource && a === action && (SCOPE_RANK[s as Scope] ?? 0) >= requiredRank;// kiểm tra xem là rank của input có lớn hơn requiredRank
  });
}
