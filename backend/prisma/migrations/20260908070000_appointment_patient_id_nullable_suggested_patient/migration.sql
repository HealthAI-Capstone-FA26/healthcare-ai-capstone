-- Guest booking + patient matching (Phase 1):
-- appointments.patient_id chuyển sang nullable — case "matched nhưng chưa xác nhận" (guest đặt
-- lịch khớp >=2 field với 1 patient MAIN có sẵn) để patient_id = NULL, chỉ set
-- suggested_patient_id, chờ lễ tân đối chiếu qua POST /appointment/sync-patient (Phase 3).

-- DropForeignKey: xoá FK RESTRICT cũ trước khi đổi patient_id sang nullable.
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_patient_id_fkey";

-- AlterTable: patient_id nullable + 2 cột mới.
ALTER TABLE "appointments" ALTER COLUMN "patient_id" DROP NOT NULL;
ALTER TABLE "appointments" ADD COLUMN "suggested_patient_id" CHAR(36);
ALTER TABLE "appointments" ADD COLUMN "suggested_reason" VARCHAR(255);

-- AddForeignKey: patient_id giữ nguyên ON DELETE RESTRICT như cũ (chỉ khác nullable).
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("patient_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: suggested_patient_id — SET NULL khi patient bị xoá (không kéo theo mất appointment),
-- giữ lại để còn audit trail kể cả sau khi patient_id thật đã được set (sync-patient không xoá).
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_suggested_patient_id_fkey" FOREIGN KEY ("suggested_patient_id") REFERENCES "patients"("patient_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "appointments_suggested_patient_id_idx" ON "appointments"("suggested_patient_id");
