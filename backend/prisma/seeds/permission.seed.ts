import { PrismaClient } from '@prisma/client';
import { PERMISSIONS_DICTIONARY } from '../../src/common/constants/permissions.dictionary';

export async function seedPermissions(prisma: PrismaClient): Promise<void> {
    const permissionData = PERMISSIONS_DICTIONARY.map(({ code, description }) => ({
        permissionCode: code,
        description,
    }));

    const uniquePermissionCodes = new Set(
        permissionData.map(({ permissionCode }) => permissionCode),
    );

    if (uniquePermissionCodes.size !== permissionData.length) {
        throw new Error('Permission dictionary contains duplicate permission codes.');
    }

    await prisma.permission.createMany({
        data: permissionData,
        skipDuplicates: true,
    });

    const count = await prisma.permission.count();
    console.log(
        `Seeded ${permissionData.length} permissions (resource:action:scope), total in DB: ${count}`,
    );
}