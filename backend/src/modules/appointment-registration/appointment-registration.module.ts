import { Module } from '@nestjs/common';

import { AppointmentController } from './appointment/appointment.controller';
import { AppointmentService } from './appointment/appointment.service';
import { GuestAppointmentController } from './appointment/guest-appointment.controller';
import { GuestAppointmentService } from './appointment/guest-appointment.service';
import { GuestAppointmentOtpStore } from './appointment/guest-appointment-otp.store';

import { AppointmentSlotController } from '../shared/appointment-slot/appointment-slot.controller';
import { AppointmentSlotService } from '../shared/appointment-slot/appointment-slot.service';

import { DoctorScheduleController } from '../shared/doctor-schedule/doctor-schedule.controller';
import { DoctorScheduleService } from '../shared/doctor-schedule/doctor-schedule.service';

import { DoctorDepartmentController } from '../shared/doctor-department/doctor-department.controller';
import { DoctorDepartmentService } from '../shared/doctor-department/doctor-department.service';

import { StaffDepartmentController } from '../shared/staff-department/staff-department.controller';
import { StaffDepartmentService } from '../shared/staff-department/staff-department.service';

import { QueueTicketController } from './queue-ticket/queue-ticket.controller';
import { QueueTicketService } from './queue-ticket/queue-ticket.service';

import { DepartmentSuggestionController } from './department-suggestion/department-suggestion.controller';

import { PatientController } from './patient/patient.controller';
import { PatientService } from './patient/patient.service';

import { PatientContactController } from './patientContact/patient-contact.controller';
import { PatientContactService } from './patientContact/patient-contact.service';
import { ContactRequestOtpStore } from './patientContact/contact-request-otp.store';

import { WeeklyScheduleGenCron } from '../../common/cron/weekly-schedule-gen.cron';
import { ExpireSlotsCron } from '../../common/cron/expire-slots.cron';
import { CleanupDraftPatientsCron } from '../../common/cron/cleanup-draft-patients.cron';

import { ReceptionIntakeModule } from '../reception-intake/reception-intake.module';
import { UserModule } from '../user/user.module';
import { DepartmentSuggestionService } from './department-suggestion/department-suggestion.service';
import { DepartmentEmbeddingService } from './department-suggestion/department-embedding.service';

/**
 * Gom toàn bộ domain nghiệp vụ đăng ký khám (Module 2 — Đăng ký khám chữa bệnh):
 * Patient, PatientContact, DoctorDepartment, DoctorSchedule, AppointmentSlot,
 * Appointment, QueueTicket, DepartmentSuggestion. Các domain này phụ thuộc chặt vào nhau (đặt lịch
 * cho hồ sơ bệnh nhân qua PatientContact, DoctorSchedule sinh AppointmentSlot,
 * AppointmentSlot được Appointment đặt, Appointment at-hospital sinh
 * QueueTicket, bác sĩ gán chuyên khoa qua DoctorDepartment, Appointment at-hospital tự suy ra
 * departmentId từ triệu chứng qua DepartmentSuggestion khi lễ tân không truyền sẵn) nên được hợp
 * nhất thành 1 module duy nhất thay vì tách rời như trước.
 *
 * Import ReceptionIntakeModule (Module 3) để QueueTicketService gọi được EncounterService
 * ngay tại bước done() — xem comment trong ReceptionIntakeModule.
 */
@Module({
  imports: [ReceptionIntakeModule, UserModule],
  controllers: [
    PatientController,
    PatientContactController,
    DoctorDepartmentController,
    StaffDepartmentController,
    DoctorScheduleController,
    AppointmentSlotController,
    AppointmentController,
    GuestAppointmentController,
    QueueTicketController,
    DepartmentSuggestionController,
  ],
  providers: [
    PatientService,
    PatientContactService,
    ContactRequestOtpStore,
    DoctorDepartmentService,
    StaffDepartmentService,
    DoctorScheduleService,
    AppointmentSlotService,
    AppointmentService,
    GuestAppointmentService,
    GuestAppointmentOtpStore,
    QueueTicketService,
    DepartmentSuggestionService,
    DepartmentEmbeddingService,
    WeeklyScheduleGenCron,
    ExpireSlotsCron,
    CleanupDraftPatientsCron,
  ],
  exports: [
    PatientService,
    PatientContactService,
    DoctorDepartmentService,
    StaffDepartmentService,
    DoctorScheduleService,
    AppointmentSlotService,
    AppointmentService,
    QueueTicketService,
    DepartmentSuggestionService,
  ],
})
export class AppointmentRegistrationModule { }