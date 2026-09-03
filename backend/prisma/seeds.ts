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

async function seedDepartments(): Promise<void> {
  const departments = [
    {
      departmentCode: 'IM',
      departmentName: 'Khoa Nội',
      description: 'Chẩn đoán và điều trị bệnh nội khoa',
      roomLocation: 'Tầng 1 - Phòng 101',
      isActive: true,
    },
    {
      departmentCode: 'SUR',
      departmentName: 'Khoa Ngoại',
      description: 'Phẫu thuật và can thiệp ngoại khoa',
      roomLocation: 'Tầng 2 - Phòng 201',
      isActive: true,
    },
    {
      departmentCode: 'PED',
      departmentName: 'Khoa Nhi',
      description: 'Chăm sóc và điều trị trẻ em',
      roomLocation: 'Tầng 1 - Phòng 102',
      isActive: true,
    },
    {
      departmentCode: 'OBG',
      departmentName: 'Khoa Sản',
      description: 'Sản phụ khoa và chăm sóc thai sản',
      roomLocation: 'Tầng 3 - Phòng 301',
      isActive: true,
    },
    {
      departmentCode: 'CAR',
      departmentName: 'Khoa Tim Mạch',
      description: 'Khám và điều trị bệnh tim mạch',
      roomLocation: 'Tầng 2 - Phòng 202',
      isActive: true,
    },
    {
      departmentCode: 'NEU',
      departmentName: 'Khoa Thần Kinh',
      description: 'Chẩn đoán và điều trị các bệnh thần kinh',
      roomLocation: 'Tầng 3 - Phòng 302',
      isActive: true,
    },
    {
      departmentCode: 'ORT',
      departmentName: 'Khoa Chấn Thương Chỉnh Hình',
      description: 'Điều trị các vấn đề xương khớp và chấn thương',
      roomLocation: 'Tầng 2 - Phòng 203',
      isActive: true,
    },
    {
      departmentCode: 'ER',
      departmentName: 'Khoa Cấp Cứu',
      description: 'Hỗ trợ y tế khẩn cấp và tai nạn',
      roomLocation: 'Tầng G - Phòng 001',
      isActive: true,
    },
  ];

  for (const item of departments) {
    await prisma.department.upsert({
      where: { departmentCode: item.departmentCode },
      update: {
        departmentName: item.departmentName,
        description: item.description,
        roomLocation: item.roomLocation,
        isActive: item.isActive,
      },
      create: item,
    });
  }

  const count = await prisma.department.count();
  console.log(`Seeded departments, total in DB: ${count}`);
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

  // 3. Seed các khoa mẫu mặc định của bệnh viện.
  await seedDepartments();

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