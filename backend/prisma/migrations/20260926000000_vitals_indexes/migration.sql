-- Module 4 (Vitals & Triage) — recommended indexes from module4.md section 8
-- "Đề xuất Index (hiệu năng)" that were missing from the schema:
--   VITAL_SIGN_SESSIONS   (encounter_id, measured_at DESC)
--   VITAL_SIGN_SESSIONS   (patient_id, measured_at DESC)
--   VITAL_SIGN_THRESHOLDS (item_id, age_min, age_max, gender)
--   VITAL_SIGN_ALERTS     (status, alert_level, created_at DESC)
-- VITAL_SIGN_OBSERVATIONS(session_id, item_id) already exists as a UNIQUE
-- constraint (@@unique([vitalSessionId, itemId])), which Postgres already
-- uses as an index, so no separate index is needed there.

CREATE INDEX "vital_sign_sessions_encounter_id_measured_at_idx"
  ON "vital_sign_sessions"("encounter_id", "measured_at" DESC);

CREATE INDEX "vital_sign_sessions_patient_id_measured_at_idx"
  ON "vital_sign_sessions"("patient_id", "measured_at" DESC);

CREATE INDEX "vital_sign_thresholds_item_id_age_min_age_max_gender_idx"
  ON "vital_sign_thresholds"("item_id", "age_min", "age_max", "gender");

CREATE INDEX "vital_sign_alerts_status_alert_level_created_at_idx"
  ON "vital_sign_alerts"("status", "alert_level", "created_at" DESC);
