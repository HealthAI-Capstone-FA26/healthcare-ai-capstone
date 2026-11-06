import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from 'prisma/prisma.service';
import { ACTOR_ROLE } from '../../src/common/constants/actor-role.constant';
import { seedRoles } from './01-role.seed';
import { seedPermissions } from './02-permission.seed';
import { seedConsentPolicies } from './04-consent-policy.seed';
import { seedDiagnosticRooms } from './05-diagnostic-room.seed';
import { seedServiceCatalog } from './06-service-catalog.seed';
import { seedResultParameters } from './07-result-parameter.seed';
import { seedVitalSignItems } from './08-vital-sign-item.seed';
import { seedVitalSignThresholds } from './09-vital-sign-threshold.seed';
import { seedResultParameterThresholds } from './20-result-parameter-threshold.seed';

export async function seedLabAccount(prisma: PrismaService | PrismaClient): Promise<void> {
    const db = prisma as PrismaService;

    // 1. Đảm bảo tất cả các Roles chuẩn tồn tại
    await seedRoles(db);
    await seedPermissions(db);

    const roles = await prisma.role.findMany();
    const roleMap = new Map(roles.map((r) => [r.roleCode, r.roleId]));

    // Gán full permissions cho các role nội bộ (trừ PATIENT chỉ được gán quyền :own)
    const allPermissions = await prisma.permission.findMany();
    if (allPermissions.length > 0) {
        const patientRoleObj = roles.find((r) => r.roleCode.toUpperCase() === ACTOR_ROLE.PATIENT);
        if (patientRoleObj) {
            const nonOwnPermIds = allPermissions
                .filter((p) => !p.permissionCode.endsWith(':own'))
                .map((p) => p.permissionId);
            if (nonOwnPermIds.length > 0) {
                await prisma.rolePermission.deleteMany({
                    where: {
                        roleId: patientRoleObj.roleId,
                        permissionId: { in: nonOwnPermIds },
                    },
                });
            }
        }

        const rolePermData: { roleId: string; permissionId: string }[] = [];
        for (const r of roles) {
            const isPatientRole = r.roleCode.toUpperCase() === ACTOR_ROLE.PATIENT;
            for (const p of allPermissions) {
                if (isPatientRole && !p.permissionCode.endsWith(':own')) {
                    continue;
                }
                rolePermData.push({ roleId: r.roleId, permissionId: p.permissionId });
            }
        }
        await prisma.rolePermission.createMany({
            data: rolePermData,
            skipDuplicates: true,
        });
    }

    const defaultPasswordHash = await bcrypt.hash('Password123@', 10);
    const adminPasswordHash = await bcrypt.hash('Admin@123', 10);

    // Helper tạo User + UserProfile
    const upsertAccount = async (opts: {
        email: string;
        passwordHash: string;
        roleCode: string;
        fullName: string;
        phoneNumber: string;
    }) => {
        const roleId = roleMap.get(opts.roleCode)!;
        const user = await prisma.user.upsert({
            where: { email: opts.email },
            update: {
                passwordHash: opts.passwordHash,
                status: 'active',
                emailVerified: true,
                mfaEnabled: false,
                failedLoginAttempts: 0,
                lockedUntil: null,
                roleId,
            },
            create: {
                email: opts.email,
                passwordHash: opts.passwordHash,
                status: 'active',
                emailVerified: true,
                mfaEnabled: false,
                roleId,
            },
        });

        await prisma.userProfile.upsert({
            where: { userId: user.userId },
            update: {
                fullName: opts.fullName,
                phoneNumber: opts.phoneNumber,
            },
            create: {
                userId: user.userId,
                fullName: opts.fullName,
                phoneNumber: opts.phoneNumber,
            },
        });

        return user;
    };

    // 2. Tài khoản ADMIN: admin@gmail.com / Admin@123
    const adminUser = await upsertAccount({
        email: 'admin@gmail.com',
        passwordHash: adminPasswordHash,
        roleCode: ACTOR_ROLE.ADMIN,
        fullName: 'Quản trị viên Hệ thống (Admin)',
        phoneNumber: '0900000001',
    });

    // 3. Tài khoản DOCTOR: doctor@gmail.com / Password123@
    const doctorUser = await upsertAccount({
        email: 'doctor@gmail.com',
        passwordHash: defaultPasswordHash,
        roleCode: ACTOR_ROLE.DOCTOR,
        fullName: 'BS.CKII Nguyễn Văn Tim',
        phoneNumber: '0900000002',
    });

    await prisma.doctor.upsert({
        where: { userId: doctorUser.userId },
        update: {
            fullName: 'BS.CKII Nguyễn Văn Tim',
            title: 'BS.CKII',
            specialization: 'general_cardiology',
            isActive: true,
        },
        create: {
            userId: doctorUser.userId,
            doctorCode: 'DOC-001',
            fullName: 'BS.CKII Nguyễn Văn Tim',
            title: 'BS.CKII',
            licenseNumber: 'CCHN-TIM-001',
            specialization: 'general_cardiology',
            isActive: true,
        },
    });

    // 4. Tài khoản RECEPTIONIST: receptionist@gmail.com / Password123@
    const receptionistUser = await upsertAccount({
        email: 'receptionist@gmail.com',
        passwordHash: defaultPasswordHash,
        roleCode: ACTOR_ROLE.RECEPTIONIST,
        fullName: 'Lễ tân Nguyễn Thị Tiếp Đón',
        phoneNumber: '0900000003',
    });

    // 5. Tài khoản NURSE: nurse@gmail.com / Password123@
    const nurseUser = await upsertAccount({
        email: 'nurse@gmail.com',
        passwordHash: defaultPasswordHash,
        roleCode: ACTOR_ROLE.NURSE,
        fullName: 'ĐD. Trần Thị Điều Dưỡng',
        phoneNumber: '0900000004',
    });

    // 6. Tài khoản LAB_STAFF: lab@gmail.com / Password123@
    const labUser = await upsertAccount({
        email: 'lab@gmail.com',
        passwordHash: defaultPasswordHash,
        roleCode: ACTOR_ROLE.LAB_STAFF,
        fullName: 'KTV. Trương Lê Danh Thái',
        phoneNumber: '0900000005',
    });

    // Đảm bảo phòng Xét nghiệm Máu (BLOOD-LAB) tồn tại và gán KTV
    const bloodLabRoom = await prisma.diagnosticRoom.upsert({
        where: { diagnosticRoomCode: 'BLOOD-LAB' },
        update: {},
        create: {
            diagnosticRoomCode: 'BLOOD-LAB',
            diagnosticRoomName: 'Phòng Xét nghiệm Máu (Blood Test Lab)',
            modality: 'blood_test',
            location: 'Tầng 1 - Khu Xét nghiệm - Phòng 105',
            isActive: true,
        },
    });

    await prisma.diagnosticStaffRoomAssignment.upsert({
        where: {
            userId_diagnosticRoomId: {
                userId: labUser.userId,
                diagnosticRoomId: bloodLabRoom.diagnosticRoomId,
            },
        },
        update: { isPrimary: true },
        create: {
            userId: labUser.userId,
            diagnosticRoomId: bloodLabRoom.diagnosticRoomId,
            isPrimary: true,
        },
    });

    // 7. Tài khoản PATIENT mẫu: patient@gmail.com / Password123@
    const patientUser = await upsertAccount({
        email: 'patient@gmail.com',
        passwordHash: defaultPasswordHash,
        roleCode: ACTOR_ROLE.PATIENT,
        fullName: 'Nguyễn Quang Huy',
        phoneNumber: '0900000006',
    });

    await prisma.patient.upsert({
        where: { userId: patientUser.userId },
        update: {
            fullName: 'Nguyễn Quang Huy',
            status: 'main',
            isActive: true,
            identityVerified: true,
        },
        create: {
            userId: patientUser.userId,
            patientCode: 'BN2611030001',
            fullName: 'Nguyễn Quang Huy',
            dateOfBirth: new Date('1995-05-15'),
            gender: 'male',
            phoneNumber: '0900000006',
            email: 'patient@gmail.com',
            status: 'main',
            isActive: true,
            identityVerified: true,
        },
    });

    console.log('Seeded all accounts successfully:', {
        admin: adminUser.email,
        doctor: doctorUser.email,
        receptionist: receptionistUser.email,
        nurse: nurseUser.email,
        lab: labUser.email,
        patient: patientUser.email,
    });
}

if (require.main === module) {
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
    const prisma = new PrismaClient({ adapter }) as unknown as PrismaService;
    (async () => {
        await seedLabAccount(prisma);
        await seedConsentPolicies(prisma);
        await seedDiagnosticRooms(prisma);
        await seedServiceCatalog(prisma);
        await seedResultParameters(prisma);
        await seedVitalSignItems(prisma);
        await seedVitalSignThresholds(prisma);
        await seedResultParameterThresholds(prisma);
    })()
        .catch((err) => {
            console.error(err);
            process.exit(1);
        })
        .finally(async () => {
            await prisma.$disconnect();
        });
}
