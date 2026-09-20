ALTER TABLE "invoices"
  ALTER COLUMN "encounter_id" DROP NOT NULL;

ALTER TABLE "invoices"
  ADD COLUMN "appointment_id" CHAR(36);

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_appointment_id_fkey"
  FOREIGN KEY ("appointment_id") REFERENCES "appointments"("appointment_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "invoices_appointment_id_idx" ON "invoices"("appointment_id");