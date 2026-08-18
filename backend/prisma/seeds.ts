import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not defined. Please add it to your .env file.');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  // Seed role mặc định: patient (isDefaultRole = true để UserService.findDefaultRole() tìm ra)
  const patientRole = await prisma.role.upsert({
    where: { roleCode: 'PATIENT' },
    update: {
      isDefaultRole: true,
    },
    create: {
      roleCode: 'PATIENT',
      roleName: 'Patient',
      description: 'Bệnh nhân - role mặc định khi đăng ký tài khoản',
      isDefaultRole: true,
    },
  });

  console.log('Seeded role:', patientRole);
}

main()
  .catch((error) => {
    console.error('Seed thất bại:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });