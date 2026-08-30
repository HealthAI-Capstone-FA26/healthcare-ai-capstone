-- CreateIndex
CREATE INDEX "appointment_slots_schedule_id_status_idx" ON "appointment_slots"("schedule_id", "status");

-- CreateIndex
CREATE INDEX "appointments_department_id_appointment_date_status_idx" ON "appointments"("department_id", "appointment_date", "status");

-- CreateIndex
CREATE INDEX "appointments_patient_id_appointment_date_idx" ON "appointments"("patient_id", "appointment_date" DESC);

-- CreateIndex
CREATE INDEX "doctor_schedules_doctor_id_work_date_idx" ON "doctor_schedules"("doctor_id", "work_date");

-- CreateIndex
CREATE INDEX "queue_tickets_department_id_ticket_date_status_idx" ON "queue_tickets"("department_id", "ticket_date", "status");
