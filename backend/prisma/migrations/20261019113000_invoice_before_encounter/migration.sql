ALTER TABLE "invoices"
  ALTER COLUMN "encounter_id" DROP NOT NULL;

ALTER TABLE "invoices"
  ADD COLUMN "appointment_id" CHAR(36);

CREATE INDEX "invoices_appointment_id_status_idx"
  ON "invoices" ("appointment_id", "status");

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_appointment_id_fkey"
  FOREIGN KEY ("appointment_id") REFERENCES "appointments" ("appointment_id")
  ON DELETE SET NULL ON UPDATE CASCADE;
