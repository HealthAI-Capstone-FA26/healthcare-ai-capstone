import { SetMetadata } from '@nestjs/common';
import {
    isPermissionCode,
    PermissionCode,
} from '../constants/permissions.dictionary';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Gắn permission code bắt buộc lên route/controller.
 * Format code: `${resource}:${action}:${scope}` — khớp PERMISSIONS_DICTIONARY.
 *
 * Ví dụ:
 *   @RequirePermissions(`${Resource.PATIENT}:${Action.READ}:${Scope.OWN}`)
 *   @RequirePermissions('patient:update:group')
 */
export const RequirePermissions = (...permissions: PermissionCode[]) => {
    const invalidPermissions = permissions.filter((code) => !isPermissionCode(code));

    if (invalidPermissions.length > 0) {
        throw new Error(
            `Invalid permission code(s): ${invalidPermissions.join(', ')}. Expected format: {resource}:{action}:{scope} from enums.`,
        );
    }

    return SetMetadata(PERMISSIONS_KEY, permissions);
};

export const Permission = (...permissions: PermissionCode[]) =>
    RequirePermissions(...permissions);
