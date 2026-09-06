import { PrismaService } from 'prisma/prisma.service';
import { ACTOR_ROLE } from '../../src/common/constants/actor-role.constant';

export async function seedRoles(prisma: PrismaService) {
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
        ACTOR_ROLE.PATIENT,
        'Patient',
        'Bệnh nhân - role mặc định khi đăng ký tài khoản',
        true,
    );
    const receptionistRole = await seedRole(
        ACTOR_ROLE.RECEPTIONIST,
        'Receptionist',
        'Lễ tân - tạo/tra cứu hồ sơ bệnh nhân tại quầy',
    );
    const nurseRole = await seedRole(
        ACTOR_ROLE.NURSE,
        'Nurse',
        'Điều dưỡng - ghi nhận sinh hiệu/thể trạng (module Vitals)',
    );
    const doctorRole = await seedRole(ACTOR_ROLE.DOCTOR, 'Doctor', 'Bác sĩ');
    const labStaffRole = await seedRole(
        ACTOR_ROLE.LAB_STAFF,
        'Lab Staff',
        'Kỹ thuật viên phòng Lab - tiếp nhận & nhập kết quả xét nghiệm (module Lab-test)',
    );
    const adminRole = await seedRole(ACTOR_ROLE.ADMIN, 'Admin', 'Quản trị hệ thống - toàn quyền');

    console.log('Seeded roles:', {
        patientRole: patientRole.roleCode,
        receptionistRole: receptionistRole.roleCode,
        nurseRole: nurseRole.roleCode,
        doctorRole: doctorRole.roleCode,
        labStaffRole: labStaffRole.roleCode,
        adminRole: adminRole.roleCode,
    });
}