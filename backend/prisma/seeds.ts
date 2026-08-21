import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PERMISSIONS_DICTIONARY } from '../src/common/constants/permissions.dictionary';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not defined. Please add it to your .env file.');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// ================== SEED NGUYÊN LIỆU ==================
// Script này CHỈ seed permission dictionary + role rỗng (chưa gán quyền).
// Việc ghép role <-> permission để làm sau (Prisma Studio hoặc admin API riêng),
// tránh phải sửa file này mỗi khi đổi chính sách phân quyền.

async function seedPermissions(): Promise<void> {
  await prisma.permission.createMany({
    data: PERMISSIONS_DICTIONARY.map((item) => ({
      permissionCode: item.code,
      description: item.description,
    })),
    skipDuplicates: true,
  });

  const count = await prisma.permission.count();
  console.log(`Seeded permissions, total in DB: ${count}`);
}

async function seedRole(
  roleCode: string,
  roleName: string,
  description: string,
  isDefaultRole = false,
) {
  return prisma.role.upsert({
    where: { roleCode },
    update: { isDefaultRole },
    create: { roleCode, roleName, description, isDefaultRole },
  });
}

async function main() {
  // 1. Seed toàn bộ permission code sinh ra từ dictionary — bảng permissions phải có sẵn
  //    record thì PermissionsGuard mới có gì để so khớp.
  await seedPermissions();

  // 2. Seed các role cơ bản. isDefaultRole = true cho PATIENT để UserService.findDefaultRole()
  //    tìm ra role gán khi đăng ký tài khoản mới.
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

  // Không gán permission cho role ở đây — làm thủ công (Prisma Studio) hoặc qua
  // admin API gán role-permission ở phase sau.

  console.log('Seeded roles:', {
    patientRole: patientRole.roleCode,
    receptionistRole: receptionistRole.roleCode,
    doctorRole: doctorRole.roleCode,
    adminRole: adminRole.roleCode,
  });
}

main()
  .catch((error) => {
    console.error('Seed thất bại:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });