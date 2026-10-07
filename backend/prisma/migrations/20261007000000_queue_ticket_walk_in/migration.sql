ALTER TABLE "queue_tickets"
  ALTER COLUMN "appointment_id" DROP NOT NULL;

ALTER TABLE "queue_tickets"
  ADD COLUMN "priority" VARCHAR(20) NOT NULL DEFAULT 'normal';

-- Backfill priority của ticket cũ từ appointment tương ứng.
UPDATE "queue_tickets" qt
SET "priority" = a."priority"
FROM "appointments" a
WHERE qt."appointment_id" = a."appointment_id";
