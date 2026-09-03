/*
  Warnings:

  - A unique constraint covering the columns `[department_id,doctor_queue_date,queue_order]` on the table `doctor_queue_entries` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `doctor_queue_date` to the `doctor_queue_entries` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "consents" ADD COLUMN     "checked_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "doctor_queue_entries" ADD COLUMN     "doctor_queue_date" DATE NOT NULL;

-- AlterTable
ALTER TABLE "patient_allergies" ADD COLUMN     "substance_code" VARCHAR(50),
ADD COLUMN     "verification_status" VARCHAR(20) NOT NULL DEFAULT 'unconfirmed',
ADD COLUMN     "verified_by_user_id" CHAR(36);

-- CreateTable
CREATE TABLE "staff_departments" (
    "user_id" CHAR(36) NOT NULL,
    "department_id" CHAR(36) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_departments_pkey" PRIMARY KEY ("user_id","department_id")
);

-- CreateTable
CREATE TABLE "vital_sign_items" (
    "item_id" CHAR(36) NOT NULL,
    "item_code" VARCHAR(20) NOT NULL,
    "item_name" VARCHAR(100) NOT NULL,
    "loinc_code" VARCHAR(20),
    "unit" VARCHAR(20) NOT NULL,
    "is_calculated" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vital_sign_items_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "vital_sign_sessions" (
    "vital_session_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "patient_id" CHAR(36) NOT NULL,
    "recorded_by_user_id" CHAR(36) NOT NULL,
    "measured_at" TIMESTAMP(3) NOT NULL,
    "notes" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vital_sign_sessions_pkey" PRIMARY KEY ("vital_session_id")
);

-- CreateTable
CREATE TABLE "vital_sign_observations" (
    "observation_id" CHAR(36) NOT NULL,
    "vital_session_id" CHAR(36) NOT NULL,
    "item_id" CHAR(36) NOT NULL,
    "observation_value" DECIMAL(10,2) NOT NULL,
    "is_abnormal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vital_sign_observations_pkey" PRIMARY KEY ("observation_id")
);

-- CreateTable
CREATE TABLE "vital_sign_thresholds" (
    "vital_threshold_id" CHAR(36) NOT NULL,
    "item_id" CHAR(36) NOT NULL,
    "age_min" INTEGER,
    "age_max" INTEGER,
    "gender" VARCHAR(10),
    "min_normal" DECIMAL(10,2) NOT NULL,
    "max_normal" DECIMAL(10,2) NOT NULL,
    "min_critical" DECIMAL(10,2),
    "max_critical" DECIMAL(10,2),
    "effective_from" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vital_sign_thresholds_pkey" PRIMARY KEY ("vital_threshold_id")
);

-- CreateTable
CREATE TABLE "vital_sign_alerts" (
    "alert_id" CHAR(36) NOT NULL,
    "observation_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "vital_threshold_id" CHAR(36),
    "alert_level" VARCHAR(20) NOT NULL,
    "alert_source" VARCHAR(20) NOT NULL,
    "measured_value" DECIMAL(10,2) NOT NULL,
    "expected_min" DECIMAL(10,2),
    "expected_max" DECIMAL(10,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "confirmed_by_user_id" CHAR(36),
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vital_sign_alerts_pkey" PRIMARY KEY ("alert_id")
);

-- CreateTable
CREATE TABLE "triage_queue_entries" (
    "queue_entry_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "assigned_nurse_user_id" CHAR(36) NOT NULL,
    "department_id" CHAR(36) NOT NULL,
    "priority" VARCHAR(20) NOT NULL DEFAULT 'normal',
    "queue_order" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'waiting',
    "triage_queue_date" DATE NOT NULL,
    "entered_queue_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "session_id" CHAR(36),

    CONSTRAINT "triage_queue_entries_pkey" PRIMARY KEY ("queue_entry_id")
);

-- CreateTable
CREATE TABLE "clinical_examinations" (
    "examination_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "doctor_id" CHAR(36) NOT NULL,
    "examination_findings" TEXT NOT NULL,
    "clinical_notes" TEXT,
    "examined_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clinical_examinations_pkey" PRIMARY KEY ("examination_id")
);

-- CreateTable
CREATE TABLE "icd10_codes" (
    "icd10_code" VARCHAR(10) NOT NULL,
    "icd10_name" VARCHAR(255) NOT NULL,
    "icd10_name_vi" VARCHAR(255),
    "chapter" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_curable" BOOLEAN,

    CONSTRAINT "icd10_codes_pkey" PRIMARY KEY ("icd10_code")
);

-- CreateTable
CREATE TABLE "diagnoses" (
    "diagnosis_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "icd10_code" VARCHAR(10) NOT NULL,
    "diagnosis_name" VARCHAR(255) NOT NULL,
    "diagnosis_type" VARCHAR(20) NOT NULL,
    "ai_suggestion_id" CHAR(36),
    "diagnosed_by_user_id" CHAR(36) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" VARCHAR(255),
    "diagnosed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("diagnosis_id")
);

-- CreateTable
CREATE TABLE "ai_clinical_summaries" (
    "summary_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "model_name" VARCHAR(100) NOT NULL,
    "model_version" VARCHAR(20),
    "summary_text" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'generated',
    "generated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_clinical_summaries_pkey" PRIMARY KEY ("summary_id")
);

-- CreateTable
CREATE TABLE "ai_reference_sources" (
    "reference_id" CHAR(36) NOT NULL,
    "owner_id" CHAR(36) NOT NULL,
    "owner_type" VARCHAR(30) NOT NULL,
    "source_type" VARCHAR(30) NOT NULL,
    "source_id" CHAR(36) NOT NULL,
    "source_encounter_id" CHAR(36),
    "relevance_note" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_reference_sources_pkey" PRIMARY KEY ("reference_id")
);

-- CreateTable
CREATE TABLE "ai_diagnosis_suggestions" (
    "suggestion_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "source_type" VARCHAR(30) NOT NULL,
    "source_id" CHAR(36),
    "explanation_text" TEXT,
    "model_name" VARCHAR(100) NOT NULL,
    "model_version" VARCHAR(20),
    "icd10_code" VARCHAR(10) NOT NULL,
    "suggested_diag_name" VARCHAR(255) NOT NULL,
    "confidence_score" DECIMAL(5,4) NOT NULL,
    "rank" INTEGER NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "doctor_feedback" VARCHAR(20),
    "rejection_reason" TEXT,
    "reviewed_by_user_id" CHAR(36),
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_diagnosis_suggestions_pkey" PRIMARY KEY ("suggestion_id")
);

-- CreateTable
CREATE TABLE "medical_images" (
    "image_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "patient_id" CHAR(36),
    "image_type" VARCHAR(20) NOT NULL,
    "file_url" VARCHAR(255),
    "uploaded_by_user_id" CHAR(36) NOT NULL,
    "lab_result_id" CHAR(36) NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medical_images_pkey" PRIMARY KEY ("image_id")
);

-- CreateTable
CREATE TABLE "ai_imaging_analyses" (
    "analysis_id" CHAR(36) NOT NULL,
    "image_id" CHAR(36) NOT NULL,
    "model_name" VARCHAR(100) NOT NULL,
    "model_version" VARCHAR(20),
    "overall_finding" VARCHAR(255),
    "confidence_score" DECIMAL(5,4) NOT NULL,
    "annotated_image_url" VARCHAR(255),
    "analyzed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_imaging_analyses_pkey" PRIMARY KEY ("analysis_id")
);

-- CreateTable
CREATE TABLE "ai_imaging_findings" (
    "finding_id" CHAR(36) NOT NULL,
    "analysis_id" CHAR(36) NOT NULL,
    "finding_label" VARCHAR(255) NOT NULL,
    "confidence_score" DECIMAL(5,4) NOT NULL,
    "bounding_box" JSONB NOT NULL,
    "severity" VARCHAR(20),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_imaging_findings_pkey" PRIMARY KEY ("finding_id")
);

-- CreateTable
CREATE TABLE "test_catalog" (
    "test_type_id" CHAR(36) NOT NULL,
    "test_code" VARCHAR(20) NOT NULL,
    "test_name" VARCHAR(255) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "specimen_type" VARCHAR(50),
    "price" DECIMAL(12,2) NOT NULL,
    "turnaround_time_hours" INTEGER,
    "default_lab_room_id" CHAR(36) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_catalog_pkey" PRIMARY KEY ("test_type_id")
);

-- CreateTable
CREATE TABLE "diagnosis_test_recommendations" (
    "recommendation_id" CHAR(36) NOT NULL,
    "icd10_code" VARCHAR(10) NOT NULL,
    "test_type_id" CHAR(36) NOT NULL,
    "priority" VARCHAR(20) NOT NULL DEFAULT 'recommended',
    "rationale" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnosis_test_recommendations_pkey" PRIMARY KEY ("recommendation_id")
);

-- CreateTable
CREATE TABLE "test_orders" (
    "order_id" CHAR(36) NOT NULL,
    "order_code" VARCHAR(20) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "ordered_by_user_id" CHAR(36) NOT NULL,
    "diagnosis_id" CHAR(36),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ordered',
    "ordered_at" TIMESTAMP(3) NOT NULL,
    "notes" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_orders_pkey" PRIMARY KEY ("order_id")
);

-- CreateTable
CREATE TABLE "test_order_items" (
    "order_item_id" CHAR(36) NOT NULL,
    "order_id" CHAR(36) NOT NULL,
    "test_type_id" CHAR(36) NOT NULL,
    "was_ai_suggested" BOOLEAN NOT NULL DEFAULT false,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ordered',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_order_items_pkey" PRIMARY KEY ("order_item_id")
);

-- CreateTable
CREATE TABLE "examination_fee_catalog" (
    "fee_id" CHAR(36) NOT NULL,
    "fee_code" VARCHAR(20) NOT NULL,
    "department_id" CHAR(36),
    "fee_name" VARCHAR(100) NOT NULL,
    "fee_type" VARCHAR(20) NOT NULL DEFAULT 'standard',
    "price" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "examination_fee_catalog_pkey" PRIMARY KEY ("fee_id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "invoice_id" CHAR(36) NOT NULL,
    "invoice_code" VARCHAR(20) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "patient_id" CHAR(36) NOT NULL,
    "invoice_type" VARCHAR(20) NOT NULL,
    "subtotal_amount" DECIMAL(14,2) NOT NULL,
    "discount_amount" DECIMAL(14,2),
    "total_amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "issued_at" TIMESTAMP(3) NOT NULL,
    "due_at" TIMESTAMP(3),
    "pdf_file_url" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("invoice_id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "invoice_item_id" CHAR(36) NOT NULL,
    "invoice_id" CHAR(36) NOT NULL,
    "item_type" VARCHAR(20) NOT NULL,
    "source_id" CHAR(36) NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("invoice_item_id")
);

-- CreateTable
CREATE TABLE "payment" (
    "payment_id" CHAR(36) NOT NULL,
    "invoice_id" CHAR(36) NOT NULL,
    "payment_method" VARCHAR(20) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMP(3),
    "received_by_user_id" CHAR(36),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_pkey" PRIMARY KEY ("payment_id")
);

-- CreateTable
CREATE TABLE "payment_gateway_transactions" (
    "gateway_transaction_id" CHAR(36) NOT NULL,
    "payment_id" CHAR(36) NOT NULL,
    "provider" VARCHAR(30) NOT NULL,
    "provider_transaction_ref" VARCHAR(100) NOT NULL,
    "qr_code_data" VARCHAR(255),
    "request_payload" JSONB,
    "response_payload" JSONB,
    "status" VARCHAR(20) NOT NULL DEFAULT 'initiated',
    "initiated_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_gateway_transactions_pkey" PRIMARY KEY ("gateway_transaction_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "notification_id" CHAR(36) NOT NULL,
    "recipient_user_id" CHAR(36),
    "recipient_patient_id" CHAR(36),
    "notification_type" VARCHAR(30) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "reference_type" VARCHAR(30),
    "reference_id" CHAR(36),
    "title" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'queued',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("notification_id")
);

-- CreateTable
CREATE TABLE "lab_rooms" (
    "lab_room_id" CHAR(36) NOT NULL,
    "lab_room_code" VARCHAR(20) NOT NULL,
    "lab_room_name" VARCHAR(100) NOT NULL,
    "category" VARCHAR(30) NOT NULL,
    "location" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_rooms_pkey" PRIMARY KEY ("lab_room_id")
);

-- CreateTable
CREATE TABLE "lab_staff_room_assignments" (
    "user_id" CHAR(36) NOT NULL,
    "lab_room_id" CHAR(36) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_staff_room_assignments_pkey" PRIMARY KEY ("user_id","lab_room_id")
);

-- CreateTable
CREATE TABLE "lab_tasks" (
    "lab_task_id" CHAR(36) NOT NULL,
    "order_item_id" CHAR(36) NOT NULL,
    "lab_room_id" CHAR(36) NOT NULL,
    "assigned_lab_staff_id" CHAR(36),
    "payment_verified" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(20) NOT NULL DEFAULT 'payment_pending',
    "received_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_tasks_pkey" PRIMARY KEY ("lab_task_id")
);

-- CreateTable
CREATE TABLE "lab_result_parameters" (
    "parameter_id" CHAR(36) NOT NULL,
    "test_type_id" CHAR(36) NOT NULL,
    "parameter_code" VARCHAR(20) NOT NULL,
    "parameter_name" VARCHAR(100),
    "loinc_code" VARCHAR(20) NOT NULL,
    "unit" VARCHAR(20),
    "data_type" VARCHAR(20),
    "display_order" INTEGER NOT NULL,
    "is_active" BOOLEAN DEFAULT true,

    CONSTRAINT "lab_result_parameters_pkey" PRIMARY KEY ("parameter_id")
);

-- CreateTable
CREATE TABLE "lab_results" (
    "lab_result_id" CHAR(36) NOT NULL,
    "lab_task_id" CHAR(36) NOT NULL,
    "entered_by_user_id" CHAR(36) NOT NULL,
    "reviewed_at" TIMESTAMP(3) NOT NULL,
    "overall_conclusion" VARCHAR(255),
    "result_status" VARCHAR(20) NOT NULL DEFAULT 'preliminary',
    "resulted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_results_pkey" PRIMARY KEY ("lab_result_id")
);

-- CreateTable
CREATE TABLE "lab_result_values" (
    "result_value_id" CHAR(36) NOT NULL,
    "lab_result_id" CHAR(36) NOT NULL,
    "parameter_id" CHAR(36) NOT NULL,
    "value_numeric" DECIMAL(12,4),
    "value_text" VARCHAR(255),
    "is_abnormal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_result_values_pkey" PRIMARY KEY ("result_value_id")
);

-- CreateTable
CREATE TABLE "lab_parameter_thresholds" (
    "lab_threshold_id" CHAR(36) NOT NULL,
    "parameter_id" CHAR(36) NOT NULL,
    "age_min" INTEGER,
    "age_max" INTEGER,
    "gender" VARCHAR(10),
    "risk_level" VARCHAR(20) NOT NULL,
    "range_min" DECIMAL(12,4),
    "range_max" DECIMAL(12,4),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" DATE NOT NULL,

    CONSTRAINT "lab_parameter_thresholds_pkey" PRIMARY KEY ("lab_threshold_id")
);

-- CreateTable
CREATE TABLE "lab_result_attachments" (
    "attachment_id" CHAR(36) NOT NULL,
    "lab_result_id" CHAR(36) NOT NULL,
    "file_type" VARCHAR(20) NOT NULL,
    "file_url" VARCHAR(255) NOT NULL,
    "description" VARCHAR(255),
    "uploaded_by_user_id" CHAR(36) NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_result_attachments_pkey" PRIMARY KEY ("attachment_id")
);

-- CreateTable
CREATE TABLE "lab_result_alerts" (
    "alert_id" CHAR(36) NOT NULL,
    "result_value_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "threshold_id" CHAR(36),
    "measured_value" VARCHAR(50) NOT NULL,
    "risk_level" VARCHAR(20) NOT NULL,
    "expected_min" DECIMAL(12,4),
    "expected_max" DECIMAL(12,4),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "confirmed_by_user_id" CHAR(36),
    "confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_result_alerts_pkey" PRIMARY KEY ("alert_id")
);

-- CreateTable
CREATE TABLE "ai_lab_analyses" (
    "ai_lab_analysis_id" CHAR(36) NOT NULL,
    "lab_result_id" CHAR(36) NOT NULL,
    "model_name" VARCHAR(100) NOT NULL,
    "model_version" VARCHAR(20),
    "overall_finding" VARCHAR(255),
    "confidence_score" DECIMAL(5,4) NOT NULL,
    "analyzed_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_lab_analyses_pkey" PRIMARY KEY ("ai_lab_analysis_id")
);

-- CreateTable
CREATE TABLE "treatment_consultations" (
    "consultation_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "doctor_id" CHAR(36) NOT NULL,
    "condition_explanation" TEXT NOT NULL,
    "treatment_plan" TEXT NOT NULL,
    "lifestyle_advice" TEXT,
    "nutrition_advice" TEXT,
    "follow_up_required" BOOLEAN NOT NULL DEFAULT false,
    "follow_up_date" DATE,
    "consulted_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "treatment_consultations_pkey" PRIMARY KEY ("consultation_id")
);

-- CreateTable
CREATE TABLE "allergen_categories" (
    "category_id" CHAR(36) NOT NULL,
    "category_code" VARCHAR(30) NOT NULL,
    "category_name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allergen_categories_pkey" PRIMARY KEY ("category_id")
);

-- CreateTable
CREATE TABLE "drug_catalog" (
    "drug_id" CHAR(36) NOT NULL,
    "drug_code" VARCHAR(30) NOT NULL,
    "drug_name" VARCHAR(255) NOT NULL,
    "generic_name" VARCHAR(255) NOT NULL,
    "strength" VARCHAR(50) NOT NULL,
    "dosage_form" VARCHAR(50) NOT NULL,
    "route" VARCHAR(30) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "therapeutic_class" VARCHAR(100),
    "allergen_category_id" CHAR(36),
    "price" DECIMAL(12,2) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drug_catalog_pkey" PRIMARY KEY ("drug_id")
);

-- CreateTable
CREATE TABLE "drug_interaction" (
    "interaction_id" CHAR(36) NOT NULL,
    "drug_id_a" CHAR(36) NOT NULL,
    "drug_id_b" CHAR(36) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "description" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drug_interaction_pkey" PRIMARY KEY ("interaction_id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "prescription_id" CHAR(36) NOT NULL,
    "prescription_code" VARCHAR(20) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "diagnosis_id" CHAR(36) NOT NULL,
    "doctor_id" CHAR(36) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "certificate_serial" VARCHAR(100),
    "signed_at" TIMESTAMP(3),
    "pdf_file_url" VARCHAR(255),
    "synced_to_pharmacy_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("prescription_id")
);

-- CreateTable
CREATE TABLE "prescription_items" (
    "prescription_item_id" CHAR(36) NOT NULL,
    "prescription_id" CHAR(36) NOT NULL,
    "drug_id" CHAR(36) NOT NULL,
    "quantity" DECIMAL(10,2) NOT NULL,
    "dosage" VARCHAR(100) NOT NULL,
    "route_code" VARCHAR(30),
    "route_system" VARCHAR(255),
    "route_display" VARCHAR(100),
    "frequency" VARCHAR(50) NOT NULL,
    "duration_days" INTEGER,
    "instruction" TEXT,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("prescription_item_id")
);

-- CreateTable
CREATE TABLE "prescription_safety_alerts" (
    "alert_id" CHAR(36) NOT NULL,
    "prescription_id" CHAR(36) NOT NULL,
    "alert_type" VARCHAR(30) NOT NULL,
    "related_item_id_a" CHAR(36),
    "related_item_id_b" CHAR(36),
    "severity" VARCHAR(20) NOT NULL,
    "description" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "confirmed_by_user_id" CHAR(36),
    "confirmed_at" TIMESTAMP(3),
    "override_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescription_safety_alerts_pkey" PRIMARY KEY ("alert_id")
);

-- CreateTable
CREATE TABLE "encounter_summary_documents" (
    "document_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "patient_id" CHAR(36) NOT NULL,
    "pdf_file_url" VARCHAR(255) NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,
    "generated_by" VARCHAR(30) NOT NULL DEFAULT 'system',
    "version" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "encounter_summary_documents_pkey" PRIMARY KEY ("document_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vital_sign_items_item_code_key" ON "vital_sign_items"("item_code");

-- CreateIndex
CREATE UNIQUE INDEX "vital_sign_observations_vital_session_id_item_id_key" ON "vital_sign_observations"("vital_session_id", "item_id");

-- CreateIndex
CREATE UNIQUE INDEX "triage_queue_entries_encounter_id_key" ON "triage_queue_entries"("encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "triage_queue_entries_department_id_triage_queue_date_queue__key" ON "triage_queue_entries"("department_id", "triage_queue_date", "queue_order");

-- CreateIndex
CREATE UNIQUE INDEX "clinical_examinations_encounter_id_key" ON "clinical_examinations"("encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_clinical_summaries_encounter_id_key" ON "ai_clinical_summaries"("encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "test_catalog_test_code_key" ON "test_catalog"("test_code");

-- CreateIndex
CREATE UNIQUE INDEX "test_orders_order_code_key" ON "test_orders"("order_code");

-- CreateIndex
CREATE UNIQUE INDEX "examination_fee_catalog_fee_code_key" ON "examination_fee_catalog"("fee_code");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_code_key" ON "invoices"("invoice_code");

-- CreateIndex
CREATE UNIQUE INDEX "payment_gateway_transactions_payment_id_key" ON "payment_gateway_transactions"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_rooms_lab_room_code_key" ON "lab_rooms"("lab_room_code");

-- CreateIndex
CREATE UNIQUE INDEX "lab_tasks_order_item_id_key" ON "lab_tasks"("order_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_result_parameters_test_type_id_parameter_code_key" ON "lab_result_parameters"("test_type_id", "parameter_code");

-- CreateIndex
CREATE UNIQUE INDEX "lab_results_lab_task_id_key" ON "lab_results"("lab_task_id");

-- CreateIndex
CREATE UNIQUE INDEX "lab_result_values_lab_result_id_parameter_id_key" ON "lab_result_values"("lab_result_id", "parameter_id");

-- CreateIndex
CREATE UNIQUE INDEX "treatment_consultations_encounter_id_key" ON "treatment_consultations"("encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "allergen_categories_category_code_key" ON "allergen_categories"("category_code");

-- CreateIndex
CREATE UNIQUE INDEX "drug_catalog_drug_code_key" ON "drug_catalog"("drug_code");

-- CreateIndex
CREATE UNIQUE INDEX "drug_interaction_drug_id_a_drug_id_b_key" ON "drug_interaction"("drug_id_a", "drug_id_b");

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_prescription_code_key" ON "prescriptions"("prescription_code");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_queue_entries_department_id_doctor_queue_date_queue__key" ON "doctor_queue_entries"("department_id", "doctor_queue_date", "queue_order");

-- AddForeignKey
ALTER TABLE "staff_departments" ADD CONSTRAINT "staff_departments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_departments" ADD CONSTRAINT "staff_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_allergies" ADD CONSTRAINT "patient_allergies_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_medical_history" ADD CONSTRAINT "patient_medical_history_icd10_code_fkey" FOREIGN KEY ("icd10_code") REFERENCES "icd10_codes"("icd10_code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_sign_sessions" ADD CONSTRAINT "vital_sign_sessions_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_sign_sessions" ADD CONSTRAINT "vital_sign_sessions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("patient_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_sign_sessions" ADD CONSTRAINT "vital_sign_sessions_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_sign_observations" ADD CONSTRAINT "vital_sign_observations_vital_session_id_fkey" FOREIGN KEY ("vital_session_id") REFERENCES "vital_sign_sessions"("vital_session_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_sign_observations" ADD CONSTRAINT "vital_sign_observations_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "vital_sign_items"("item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_sign_thresholds" ADD CONSTRAINT "vital_sign_thresholds_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "vital_sign_items"("item_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_sign_alerts" ADD CONSTRAINT "vital_sign_alerts_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "vital_sign_observations"("observation_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_sign_alerts" ADD CONSTRAINT "vital_sign_alerts_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_sign_alerts" ADD CONSTRAINT "vital_sign_alerts_vital_threshold_id_fkey" FOREIGN KEY ("vital_threshold_id") REFERENCES "vital_sign_thresholds"("vital_threshold_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vital_sign_alerts" ADD CONSTRAINT "vital_sign_alerts_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_queue_entries" ADD CONSTRAINT "triage_queue_entries_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_queue_entries" ADD CONSTRAINT "triage_queue_entries_assigned_nurse_user_id_fkey" FOREIGN KEY ("assigned_nurse_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_queue_entries" ADD CONSTRAINT "triage_queue_entries_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_queue_entries" ADD CONSTRAINT "triage_queue_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "vital_sign_sessions"("vital_session_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_examinations" ADD CONSTRAINT "clinical_examinations_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_examinations" ADD CONSTRAINT "clinical_examinations_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("doctor_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_icd10_code_fkey" FOREIGN KEY ("icd10_code") REFERENCES "icd10_codes"("icd10_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_ai_suggestion_id_fkey" FOREIGN KEY ("ai_suggestion_id") REFERENCES "ai_diagnosis_suggestions"("suggestion_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_diagnosed_by_user_id_fkey" FOREIGN KEY ("diagnosed_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_clinical_summaries" ADD CONSTRAINT "ai_clinical_summaries_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_reference_sources" ADD CONSTRAINT "ai_reference_sources_source_encounter_id_fkey" FOREIGN KEY ("source_encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_diagnosis_suggestions" ADD CONSTRAINT "ai_diagnosis_suggestions_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_diagnosis_suggestions" ADD CONSTRAINT "ai_diagnosis_suggestions_icd10_code_fkey" FOREIGN KEY ("icd10_code") REFERENCES "icd10_codes"("icd10_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_diagnosis_suggestions" ADD CONSTRAINT "ai_diagnosis_suggestions_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_images" ADD CONSTRAINT "medical_images_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_images" ADD CONSTRAINT "medical_images_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("patient_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_images" ADD CONSTRAINT "medical_images_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_images" ADD CONSTRAINT "medical_images_lab_result_id_fkey" FOREIGN KEY ("lab_result_id") REFERENCES "lab_results"("lab_result_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_imaging_analyses" ADD CONSTRAINT "ai_imaging_analyses_image_id_fkey" FOREIGN KEY ("image_id") REFERENCES "medical_images"("image_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_imaging_findings" ADD CONSTRAINT "ai_imaging_findings_analysis_id_fkey" FOREIGN KEY ("analysis_id") REFERENCES "ai_imaging_analyses"("analysis_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_catalog" ADD CONSTRAINT "test_catalog_default_lab_room_id_fkey" FOREIGN KEY ("default_lab_room_id") REFERENCES "lab_rooms"("lab_room_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosis_test_recommendations" ADD CONSTRAINT "diagnosis_test_recommendations_icd10_code_fkey" FOREIGN KEY ("icd10_code") REFERENCES "icd10_codes"("icd10_code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosis_test_recommendations" ADD CONSTRAINT "diagnosis_test_recommendations_test_type_id_fkey" FOREIGN KEY ("test_type_id") REFERENCES "test_catalog"("test_type_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_orders" ADD CONSTRAINT "test_orders_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_orders" ADD CONSTRAINT "test_orders_ordered_by_user_id_fkey" FOREIGN KEY ("ordered_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_orders" ADD CONSTRAINT "test_orders_diagnosis_id_fkey" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("diagnosis_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_order_items" ADD CONSTRAINT "test_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "test_orders"("order_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_order_items" ADD CONSTRAINT "test_order_items_test_type_id_fkey" FOREIGN KEY ("test_type_id") REFERENCES "test_catalog"("test_type_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "examination_fee_catalog" ADD CONSTRAINT "examination_fee_catalog_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("patient_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("invoice_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("invoice_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment" ADD CONSTRAINT "payment_received_by_user_id_fkey" FOREIGN KEY ("received_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_gateway_transactions" ADD CONSTRAINT "payment_gateway_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payment"("payment_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_patient_id_fkey" FOREIGN KEY ("recipient_patient_id") REFERENCES "patients"("patient_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_staff_room_assignments" ADD CONSTRAINT "lab_staff_room_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_staff_room_assignments" ADD CONSTRAINT "lab_staff_room_assignments_lab_room_id_fkey" FOREIGN KEY ("lab_room_id") REFERENCES "lab_rooms"("lab_room_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_tasks" ADD CONSTRAINT "lab_tasks_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "test_order_items"("order_item_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_tasks" ADD CONSTRAINT "lab_tasks_lab_room_id_fkey" FOREIGN KEY ("lab_room_id") REFERENCES "lab_rooms"("lab_room_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_tasks" ADD CONSTRAINT "lab_tasks_assigned_lab_staff_id_fkey" FOREIGN KEY ("assigned_lab_staff_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_parameters" ADD CONSTRAINT "lab_result_parameters_test_type_id_fkey" FOREIGN KEY ("test_type_id") REFERENCES "test_catalog"("test_type_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_lab_task_id_fkey" FOREIGN KEY ("lab_task_id") REFERENCES "lab_tasks"("lab_task_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_entered_by_user_id_fkey" FOREIGN KEY ("entered_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_values" ADD CONSTRAINT "lab_result_values_lab_result_id_fkey" FOREIGN KEY ("lab_result_id") REFERENCES "lab_results"("lab_result_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_values" ADD CONSTRAINT "lab_result_values_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "lab_result_parameters"("parameter_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_parameter_thresholds" ADD CONSTRAINT "lab_parameter_thresholds_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "lab_result_parameters"("parameter_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_attachments" ADD CONSTRAINT "lab_result_attachments_lab_result_id_fkey" FOREIGN KEY ("lab_result_id") REFERENCES "lab_results"("lab_result_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_attachments" ADD CONSTRAINT "lab_result_attachments_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_alerts" ADD CONSTRAINT "lab_result_alerts_result_value_id_fkey" FOREIGN KEY ("result_value_id") REFERENCES "lab_result_values"("result_value_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_alerts" ADD CONSTRAINT "lab_result_alerts_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_alerts" ADD CONSTRAINT "lab_result_alerts_threshold_id_fkey" FOREIGN KEY ("threshold_id") REFERENCES "lab_parameter_thresholds"("lab_threshold_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_alerts" ADD CONSTRAINT "lab_result_alerts_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_lab_analyses" ADD CONSTRAINT "ai_lab_analyses_lab_result_id_fkey" FOREIGN KEY ("lab_result_id") REFERENCES "lab_results"("lab_result_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_consultations" ADD CONSTRAINT "treatment_consultations_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "treatment_consultations" ADD CONSTRAINT "treatment_consultations_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("doctor_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_catalog" ADD CONSTRAINT "drug_catalog_allergen_category_id_fkey" FOREIGN KEY ("allergen_category_id") REFERENCES "allergen_categories"("category_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_interaction" ADD CONSTRAINT "drug_interaction_drug_id_a_fkey" FOREIGN KEY ("drug_id_a") REFERENCES "drug_catalog"("drug_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drug_interaction" ADD CONSTRAINT "drug_interaction_drug_id_b_fkey" FOREIGN KEY ("drug_id_b") REFERENCES "drug_catalog"("drug_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_diagnosis_id_fkey" FOREIGN KEY ("diagnosis_id") REFERENCES "diagnoses"("diagnosis_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("doctor_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("prescription_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_drug_id_fkey" FOREIGN KEY ("drug_id") REFERENCES "drug_catalog"("drug_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_safety_alerts" ADD CONSTRAINT "prescription_safety_alerts_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions"("prescription_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_safety_alerts" ADD CONSTRAINT "prescription_safety_alerts_related_item_id_a_fkey" FOREIGN KEY ("related_item_id_a") REFERENCES "prescription_items"("prescription_item_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_safety_alerts" ADD CONSTRAINT "prescription_safety_alerts_related_item_id_b_fkey" FOREIGN KEY ("related_item_id_b") REFERENCES "prescription_items"("prescription_item_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_safety_alerts" ADD CONSTRAINT "prescription_safety_alerts_confirmed_by_user_id_fkey" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_summary_documents" ADD CONSTRAINT "encounter_summary_documents_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounter_summary_documents" ADD CONSTRAINT "encounter_summary_documents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("patient_id") ON DELETE RESTRICT ON UPDATE CASCADE;
