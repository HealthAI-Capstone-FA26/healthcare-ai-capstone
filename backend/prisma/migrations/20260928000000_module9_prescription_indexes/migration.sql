-- Module 9 (E-Prescription, Follow-up & Medical Record Export)
-- "Đề xuất Index (hiệu năng)" indexes that were missing from the schema, plus the
-- one column change (notifications.scheduled_at) that module9.md §6 requires in
-- order for the NOTIFICATIONS(scheduled_at, status) index to mean anything —
-- without it there is no column for a follow-up reminder background job to scan.
--
-- Skipped because already covered by an existing constraint:
--   * DRUG_INTERACTIONS (drug_id_a, drug_id_b) — already a UNIQUE index
--     (drug_interaction_drug_id_a_drug_id_b_key).
--
-- Not included here (out of indexing scope — schema/business-logic changes from
-- module9.md §6 that don't back any of the recommended indexes):
--   * appointments.follow_up_of_encounter_id (FK -> encounters)
--   * patient_allergies.allergen_category_id (FK -> allergen_categories)
--   * new enum values on booking_channel / invoice_type / item_type

ALTER TABLE "notifications"
  ADD COLUMN "scheduled_at" TIMESTAMP(3);

-- ---------- Module 9 (E-Prescription) ----------

CREATE INDEX "drug_catalog_generic_name_idx"
  ON "drug_catalog"("generic_name");

CREATE INDEX "drug_catalog_therapeutic_class_idx"
  ON "drug_catalog"("therapeutic_class");

CREATE INDEX "prescription_items_prescription_id_idx"
  ON "prescription_items"("prescription_id");

CREATE INDEX "prescription_safety_alerts_prescription_id_status_severity_idx"
  ON "prescription_safety_alerts"("prescription_id", "status", "severity");

CREATE INDEX "notifications_scheduled_at_status_idx"
  ON "notifications"("scheduled_at", "status");

CREATE INDEX "encounter_summary_documents_patient_id_generated_at_idx"
  ON "encounter_summary_documents"("patient_id", "generated_at" DESC);
