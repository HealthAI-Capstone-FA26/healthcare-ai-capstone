import { PrismaClient } from '@prisma/client';

export async function seedRoles(prisma: PrismaClient) {
    const seedRole = (
        roleCode: string,
        roleName: string,
        description: string,
        isDefaultRole = false,
    ) =>
        prisma.role.upsert({
            where: { roleCode },
            update: { isDefaultRole },
            create: { roleCode, roleName, description, isDefaultRole },
        });

    const patientRole = await seedRole(
        'PATIENT',
        'Patient',
        'Bệnh nhân - role mặc định khi đăng ký tài khoản',
        true,
    );
    const receptionistRole = await seedRole(
        'RECEPTIONIST',
        'Receptionist',
        'Lễ tân - tạo/tra cứu hồ sơ bệnh nhân tại quầy',
    );
    const doctorRole = await seedRole('DOCTOR', 'Doctor', 'Bác sĩ');
    const adminRole = await seedRole('ADMIN', 'Admin', 'Quản trị hệ thống - toàn quyền');

    console.log('Seeded roles:', {
        patientRole: patientRole.roleCode,
        receptionistRole: receptionistRole.roleCode,
        doctorRole: doctorRole.roleCode,
        adminRole: adminRole.roleCode,
    });
}