-- AlterTable
ALTER TABLE "vital_sign_alerts" ADD COLUMN     "reason" VARCHAR(500);

-- AlterTable
ALTER TABLE "vital_sign_thresholds" ADD COLUMN     "source_reference" VARCHAR(255);
