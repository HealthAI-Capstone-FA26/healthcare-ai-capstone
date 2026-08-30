/*
  Warnings:

  - You are about to drop the column `checked_at` on the `consents` table. All the data in the column will be lost.
  - Added the required column `signature_type` to the `consents` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "consents" DROP COLUMN "checked_at",
ADD COLUMN     "signature_data_url" VARCHAR(255),
ADD COLUMN     "signature_type" VARCHAR(20) NOT NULL,
ADD COLUMN     "signed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "patient_allergies" (
    "allergy_id" CHAR(36) NOT NULL,
    "patient_id" CHAR(36) NOT NULL,
    "allergy_type" VARCHAR(20) NOT NULL,
    "allergen_name" VARCHAR(255) NOT NULL,
    "reaction_description" TEXT,
    "severity" VARCHAR(20) NOT NULL,
    "recorded_by_user_id" CHAR(36),
    "encounter_id" CHAR(36),
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_allergies_pkey" PRIMARY KEY ("allergy_id")
);

-- CreateTable
CREATE TABLE "patient_medical_history" (
    "history_id" CHAR(36) NOT NULL,
    "patient_id" CHAR(36) NOT NULL,
    "history_type" VARCHAR(20) NOT NULL,
    "condition_name" VARCHAR(255) NOT NULL,
    "icd10_code" VARCHAR(10),
    "onset_date" DATE,
    "notes" TEXT,
    "recorded_by_user_id" CHAR(36),
    "encounter_id" CHAR(36),
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_medical_history_pkey" PRIMARY KEY ("history_id")
);

-- CreateIndex
CREATE INDEX "patient_allergies_patient_id_status_idx" ON "patient_allergies"("patient_id", "status");

-- CreateIndex
CREATE INDEX "patient_medical_history_patient_id_history_type_idx" ON "patient_medical_history"("patient_id", "history_type");

-- CreateIndex
CREATE INDEX "consents_patient_id_status_idx" ON "consents"("patient_id", "status");

-- CreateIndex
CREATE INDEX "doctor_queue_entries_doctor_id_status_queue_order_idx" ON "doctor_queue_entries"("doctor_id", "status", "queue_order");

-- CreateIndex
CREATE INDEX "encounters_patient_id_arrived_at_idx" ON "encounters"("patient_id", "arrived_at" DESC);

-- CreateIndex
CREATE INDEX "encounters_status_department_id_idx" ON "encounters"("status", "department_id");

-- CreateIndex
CREATE INDEX "patient_identity_verifications_encounter_id_verified_at_idx" ON "patient_identity_verifications"("encounter_id", "verified_at" DESC);

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("patient_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medical_history" ADD CONSTRAINT "patient_medical_history_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("patient_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medical_history" ADD CONSTRAINT "patient_medical_history_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medical_history" ADD CONSTRAINT "patient_medical_history_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
