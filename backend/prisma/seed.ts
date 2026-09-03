import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

import { seedPermissions } from './seeds/permission.seed';
import { seedRoles } from './seeds/role.seed';
import { seedDepartments } from './seeds/department.seed';
import { seedVitalSignItems } from './seeds/vital-sign-item.seed';
import { seedVitalSignThresholds } from './seeds/vital-sign-threshold.seed';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not defined. Please add it to your .env file.');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  await seedPermissions(prisma);
  await seedRoles(prisma);
  await seedDepartments(prisma);
  await seedVitalSignItems(prisma);
  await seedVitalSignThresholds(prisma);
}

main()
  .catch((error) => {
    console.error('Seed thất bại:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });