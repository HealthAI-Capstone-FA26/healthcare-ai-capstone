/*
  Warnings:

  - The primary key for the `user_roles` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_pkey",
ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id", "role_id");

-- CreateTable
CREATE TABLE "departments" (
    "department_id" CHAR(36) NOT NULL,
    "department_code" VARCHAR(20) NOT NULL,
    "department_name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(255),
    "room_location" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("department_id")
);

-- CreateTable
CREATE TABLE "doctors" (
    "doctor_id" CHAR(36) NOT NULL,
    "user_id" CHAR(36),
    "doctor_code" VARCHAR(20) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "title" VARCHAR(50),
    "license_number" VARCHAR(50),
    "specialization" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("doctor_id")
);

-- CreateTable
CREATE TABLE "doctor_departments" (
    "doctor_id" CHAR(36) NOT NULL,
    "department_id" CHAR(36) NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT true,
    "assigned_at" VARCHAR(255),

    CONSTRAINT "doctor_departments_pkey" PRIMARY KEY ("doctor_id","department_id")
);

-- CreateTable
CREATE TABLE "doctor_schedules" (
    "schedule_id" CHAR(36) NOT NULL,
    "doctor_id" CHAR(36) NOT NULL,
    "department_id" CHAR(36) NOT NULL,
    "work_date" DATE NOT NULL,
    "session" VARCHAR(20) NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "slot_duration_mins" INTEGER NOT NULL,
    "max_patients_per_slot" INTEGER NOT NULL,
    "status" VARCHAR(255) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_schedules_pkey" PRIMARY KEY ("schedule_id")
);

-- CreateTable
CREATE TABLE "appointment_slots" (
    "slot_id" CHAR(36) NOT NULL,
    "schedule_id" CHAR(36) NOT NULL,
    "slot_start_time" TIMESTAMP(3) NOT NULL,
    "slot_end_time" TIMESTAMP(3) NOT NULL,
    "capacity" INTEGER NOT NULL,
    "booked_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL DEFAULT 'free',

    CONSTRAINT "appointment_slots_pkey" PRIMARY KEY ("slot_id")
);

-- CreateTable
CREATE TABLE "patients" (
    "patient_id" CHAR(36) NOT NULL,
    "user_id" CHAR(36),
    "patient_code" VARCHAR(20) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" VARCHAR(10) NOT NULL,
    "identity_number" VARCHAR(20),
    "insurance_number" VARCHAR(20),
    "phone_number" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255),
    "address" VARCHAR(255),
    "ethnicity" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "identity_verified" BOOLEAN NOT NULL DEFAULT false,
    "identity_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("patient_id")
);

-- CreateTable
CREATE TABLE "patient_contacts" (
    "contact_id" CHAR(36) NOT NULL,
    "user_id" CHAR(36) NOT NULL,
    "patient_id" CHAR(36) NOT NULL,
    "relationship" VARCHAR(255) NOT NULL,
    "is_primary_contact" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_contacts_pkey" PRIMARY KEY ("contact_id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "appointment_id" CHAR(36) NOT NULL,
    "appointment_code" VARCHAR(20) NOT NULL,
    "patient_id" CHAR(36) NOT NULL,
    "doctor_id" CHAR(36),
    "department_id" CHAR(36) NOT NULL,
    "slot_id" CHAR(36),
    "booked_by_user_id" CHAR(36),
    "booking_channel" VARCHAR(20) NOT NULL,
    "appointment_date" DATE NOT NULL,
    "appointment_time" TIME,
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "reason_for_visit" VARCHAR(255),
    "priority" VARCHAR(20) NOT NULL DEFAULT 'normal',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" VARCHAR(255),

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("appointment_id")
);

-- CreateTable
CREATE TABLE "encounters" (
    "encounter_id" CHAR(36) NOT NULL,
    "appointment_id" CHAR(36) NOT NULL,
    "patient_id" CHAR(36) NOT NULL,
    "department_id" CHAR(36) NOT NULL,
    "doctor_id" CHAR(36),
    "encounter_code" VARCHAR(20) NOT NULL,
    "patient_type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'arrived',
    "arrived_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registered_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encounters_pkey" PRIMARY KEY ("encounter_id")
);

-- CreateTable
CREATE TABLE "chief_complaints" (
    "complaint_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "reason_for_visit" VARCHAR(255),
    "symptoms" TEXT,
    "symptom_onset_date" DATE,
    "pain_level" INTEGER,
    "input_channel" VARCHAR(20) NOT NULL,
    "recorded_by_user_id" CHAR(36) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chief_complaints_pkey" PRIMARY KEY ("complaint_id")
);

-- CreateTable
CREATE TABLE "patient_identity_verifications" (
    "verification_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "verified_by_user_id" CHAR(36) NOT NULL,
    "verification_method" VARCHAR(20) NOT NULL,
    "verification_status" VARCHAR(20) NOT NULL,
    "mismatch_notes" VARCHAR(255),
    "verified_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_identity_verifications_pkey" PRIMARY KEY ("verification_id")
);

-- CreateTable
CREATE TABLE "doctor_queue_entries" (
    "queue_entry_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36) NOT NULL,
    "doctor_id" CHAR(36) NOT NULL,
    "department_id" CHAR(36) NOT NULL,
    "queue_order" INTEGER NOT NULL,
    "priority" VARCHAR(20) NOT NULL DEFAULT 'normal',
    "status" VARCHAR(20) NOT NULL DEFAULT 'waiting',
    "entered_queue_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_at" TIMESTAMP(3),
    "exam_started_at" TIMESTAMP(3),
    "routed_by_user_id" CHAR(36),

    CONSTRAINT "doctor_queue_entries_pkey" PRIMARY KEY ("queue_entry_id")
);

-- CreateTable
CREATE TABLE "queue_tickets" (
    "ticket_id" CHAR(36) NOT NULL,
    "appointment_id" CHAR(36) NOT NULL,
    "department_id" CHAR(36) NOT NULL,
    "ticket_prefix" CHAR(1) NOT NULL,
    "ticket_date" DATE NOT NULL,
    "ticket_number" INTEGER NOT NULL,
    "called_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(20) NOT NULL DEFAULT 'waiting',
    "counter_number" VARCHAR(20),

    CONSTRAINT "queue_tickets_pkey" PRIMARY KEY ("ticket_id")
);

-- CreateTable
CREATE TABLE "reception_checkins" (
    "checkin_id" CHAR(36) NOT NULL,
    "appointment_id" CHAR(36) NOT NULL,
    "reception_staff_user_id" CHAR(36) NOT NULL,
    "checkin_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counter_number" VARCHAR(20),
    "notes" VARCHAR(255),

    CONSTRAINT "reception_checkins_pkey" PRIMARY KEY ("checkin_id")
);

-- CreateTable
CREATE TABLE "consent_policies" (
    "policy_id" CHAR(36) NOT NULL,
    "policy_code" VARCHAR(50) NOT NULL,
    "policy_type" VARCHAR(30) NOT NULL,
    "version" VARCHAR(20) NOT NULL,
    "content_url" VARCHAR(255) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_policies_pkey" PRIMARY KEY ("policy_id")
);

-- CreateTable
CREATE TABLE "consents" (
    "consent_id" CHAR(36) NOT NULL,
    "patient_id" CHAR(36) NOT NULL,
    "encounter_id" CHAR(36),
    "policy_id" CHAR(36) NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "witnessed_by_user_id" CHAR(36),
    "ip_address" VARCHAR(45),
    "device_info" VARCHAR(255),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" VARCHAR(255),

    CONSTRAINT "consents_pkey" PRIMARY KEY ("consent_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "departments_department_code_key" ON "departments"("department_code");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_user_id_key" ON "doctors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_doctor_code_key" ON "doctors"("doctor_code");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_license_number_key" ON "doctors"("license_number");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_schedules_doctor_id_work_date_session_key" ON "doctor_schedules"("doctor_id", "work_date", "session");

-- CreateIndex
CREATE UNIQUE INDEX "patients_user_id_key" ON "patients"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "patients_patient_code_key" ON "patients"("patient_code");

-- CreateIndex
CREATE UNIQUE INDEX "patients_identity_number_key" ON "patients"("identity_number");

-- CreateIndex
CREATE UNIQUE INDEX "patients_insurance_number_key" ON "patients"("insurance_number");

-- CreateIndex
CREATE UNIQUE INDEX "patient_contacts_user_id_patient_id_key" ON "patient_contacts"("user_id", "patient_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_appointment_code_key" ON "appointments"("appointment_code");

-- CreateIndex
CREATE UNIQUE INDEX "encounters_appointment_id_key" ON "encounters"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "encounters_encounter_code_key" ON "encounters"("encounter_code");

-- CreateIndex
CREATE UNIQUE INDEX "chief_complaints_encounter_id_key" ON "chief_complaints"("encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "doctor_queue_entries_encounter_id_key" ON "doctor_queue_entries"("encounter_id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_tickets_appointment_id_key" ON "queue_tickets"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "queue_tickets_department_id_ticket_prefix_ticket_date_ticke_key" ON "queue_tickets"("department_id", "ticket_prefix", "ticket_date", "ticket_number");

-- CreateIndex
CREATE UNIQUE INDEX "consent_policies_policy_code_key" ON "consent_policies"("policy_code");

-- CreateIndex
CREATE UNIQUE INDEX "consent_policies_policy_type_version_key" ON "consent_policies"("policy_type", "version");

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_departments" ADD CONSTRAINT "doctor_departments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("doctor_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_departments" ADD CONSTRAINT "doctor_departments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("doctor_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_slots" ADD CONSTRAINT "appointment_slots_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "doctor_schedules"("schedule_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_contacts" ADD CONSTRAINT "patient_contacts_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("patient_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("patient_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("doctor_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "appointment_slots"("slot_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_booked_by_user_id_fkey" FOREIGN KEY ("booked_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("appointment_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("patient_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("doctor_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chief_complaints" ADD CONSTRAINT "chief_complaints_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chief_complaints" ADD CONSTRAINT "chief_complaints_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_identity_verifications" ADD CONSTRAINT "patient_identity_verifications_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_identity_verifications" ADD CONSTRAINT "patient_identity_verifications_verified_by_user_id_fkey" FOREIGN KEY ("verified_by_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_queue_entries" ADD CONSTRAINT "doctor_queue_entries_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_queue_entries" ADD CONSTRAINT "doctor_queue_entries_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("doctor_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_queue_entries" ADD CONSTRAINT "doctor_queue_entries_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_queue_entries" ADD CONSTRAINT "doctor_queue_entries_routed_by_user_id_fkey" FOREIGN KEY ("routed_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("appointment_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reception_checkins" ADD CONSTRAINT "reception_checkins_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("appointment_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reception_checkins" ADD CONSTRAINT "reception_checkins_reception_staff_user_id_fkey" FOREIGN KEY ("reception_staff_user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("patient_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_encounter_id_fkey" FOREIGN KEY ("encounter_id") REFERENCES "encounters"("encounter_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "consent_policies"("policy_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_witnessed_by_user_id_fkey" FOREIGN KEY ("witnessed_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
