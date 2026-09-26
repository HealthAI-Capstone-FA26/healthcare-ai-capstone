-- Indexes recommended in "Đề xuất Index (hiệu năng)" of module5.md, module6.md,
-- module7.md and module8.md that were missing from the schema.
--
-- Notes on entries that were intentionally skipped because an equivalent index
-- already exists:
--   * module5.md "AI_SUMMARY_REFERENCES (summary_id, source_type)" — this table
--     was already refactored (per module8.md §6) into ai_reference_sources with
--     polymorphic owner_type/owner_id; module8.md's own recommendation for that
--     table, (owner_type, owner_id), is created below instead.
--   * module7.md "LAB_RESULT_VALUES (lab_result_id)" — already covered by the
--     existing UNIQUE (lab_result_id, parameter_id) index (leftmost prefix).
--   * module8.md "TREATMENT_CONSULTATIONS (encounter_id)" — already a UNIQUE
--     column, which Postgres already indexes.
--   * module8.md "PATIENT_ALLERGIES (patient_id, status)" and
--     "PATIENT_MEDICAL_HISTORY (patient_id, history_type)" — already created by
--     the Module 2/3 migrations.

-- ---------- Module 5 (Examination, AI-Assisted Diagnosis & Test Orders) ----------

CREATE INDEX "diagnoses_encounter_id_is_primary_idx"
  ON "diagnoses"("encounter_id", "is_primary");

CREATE INDEX "ai_diagnosis_suggestions_encounter_id_rank_idx"
  ON "ai_diagnosis_suggestions"("encounter_id", "rank");

CREATE INDEX "ai_diagnosis_suggestions_doctor_feedback_generated_at_idx"
  ON "ai_diagnosis_suggestions"("doctor_feedback", "generated_at");

CREATE INDEX "diagnosis_test_recommendations_icd10_code_priority_idx"
  ON "diagnosis_test_recommendations"("icd10_code", "priority");

CREATE INDEX "test_order_items_order_id_idx"
  ON "test_order_items"("order_id");

-- ---------- Module 6 (Billing & Payment) ----------

CREATE INDEX "invoices_patient_id_status_idx"
  ON "invoices"("patient_id", "status");

CREATE INDEX "invoices_encounter_id_idx"
  ON "invoices"("encounter_id");

CREATE INDEX "payment_invoice_id_status_idx"
  ON "payment"("invoice_id", "status");

CREATE INDEX "payment_gateway_transactions_provider_transaction_ref_idx"
  ON "payment_gateway_transactions"("provider_transaction_ref");

CREATE INDEX "notifications_recipient_patient_id_status_created_at_idx"
  ON "notifications"("recipient_patient_id", "status", "created_at" DESC);

-- ---------- Module 7 (Lab Processing & Results) ----------

CREATE INDEX "lab_tasks_lab_room_id_status_idx"
  ON "lab_tasks"("lab_room_id", "status");

CREATE INDEX "lab_result_values_parameter_id_is_abnormal_idx"
  ON "lab_result_values"("parameter_id", "is_abnormal");

CREATE INDEX "lab_result_alerts_risk_level_status_created_at_idx"
  ON "lab_result_alerts"("risk_level", "status", "created_at" DESC);

CREATE INDEX "lab_parameter_thresholds_parameter_id_age_min_age_max_gender_idx"
  ON "lab_parameter_thresholds"("parameter_id", "age_min", "age_max", "gender");

-- ---------- Module 8 (Post-Lab Diagnosis & Consultation) ----------

CREATE INDEX "ai_reference_sources_owner_type_owner_id_idx"
  ON "ai_reference_sources"("owner_type", "owner_id");

CREATE INDEX "diagnoses_encounter_id_diagnosis_type_idx"
  ON "diagnoses"("encounter_id", "diagnosis_type");
