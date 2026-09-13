import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { seedDepartments } from './seeds/department.seed';
import { seedRoles } from './seeds/role.seed';
import { seedPermissions } from './seeds/permission.seed';
import { seedVitalSignItems } from './seeds/vital-sign-item.seed';
import { seedVitalSignThresholds } from './seeds/vital-sign-threshold.seed';
import { seedLabParameterThresholds } from './seeds/lab-parameter-threshold.seed';
import { seedAllergenCategories } from './seeds/allergen-category.seed';
import { seedDrugCatalog } from './seeds/drug-catalog.seed';
import { seedDrugInteractions } from './seeds/drug-interaction.seed';
import { seedIcd10Codes } from './seeds/icd10-code.seed';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    const adapter = new PrismaPg({ connectionString });

    super({ adapter });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

// Runner gọi bởi `npm run seed` (ts-node prisma/seed.ts). Thứ tự phản ánh phụ thuộc dữ liệu:
// các seed danh mục độc lập trước, seed phụ thuộc danh mục (threshold, drug catalog...) sau.
async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();

  try {
    await seedDepartments(prisma);
    await seedRoles(prisma);
    await seedPermissions(prisma);

    await seedVitalSignItems(prisma);
    await seedVitalSignThresholds(prisma);
    await seedLabParameterThresholds(prisma);

    // Module 9 — Kê đơn thuốc
    await seedAllergenCategories(prisma);
    await seedDrugCatalog(prisma);
    await seedDrugInteractions(prisma);
    await seedIcd10Codes(prisma);
  } finally {
    await prisma.onModuleDestroy();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('Seed thất bại:', error);
    process.exit(1);
  });
}