import { Module } from '@nestjs/common';

import { AppointmentController } from './appointment/appointment.controller';
import { AppointmentService } from './appointment/appointment.service';

import { AppointmentSlotController } from './appointment-slot/appointment-slot.controller';
import { AppointmentSlotService } from './appointment-slot/appointment-slot.service';

import { DoctorScheduleController } from './doctor-schedule/doctor-schedule.controller';
import { DoctorScheduleService } from './doctor-schedule/doctor-schedule.service';

import { DoctorDepartmentController } from './doctor-department/doctor-department.controller';
import { DoctorDepartmentService } from './doctor-department/doctor-department.service';

import { QueueTicketController } from './queue-ticket/queue-ticket.controller';
import { QueueTicketService } from './queue-ticket/queue-ticket.service';

import { PatientController } from './patient/patient.controller';
import { PatientService } from './patient/patient.service';

import { PatientContactController } from './patientContact/patient-contact.controller';
import { PatientContactService } from './patientContact/patient-contact.service';

import { WeeklyScheduleGenCron } from '../../common/cron/weekly-schedule-gen.cron';
import { ExpireSlotsCron } from '../../common/cron/expire-slots.cron';

/**
 * Gom toàn bộ domain nghiệp vụ đăng ký khám (Module 2 — Đăng ký khám chữa bệnh):
 * Patient, PatientContact, DoctorDepartment, DoctorSchedule, AppointmentSlot,
 * Appointment, QueueTicket. Các domain này phụ thuộc chặt vào nhau (đặt lịch
 * cho hồ sơ bệnh nhân qua PatientContact, DoctorSchedule sinh AppointmentSlot,
 * AppointmentSlot được Appointment đặt, Appointment at-hospital sinh
 * QueueTicket, bác sĩ gán chuyên khoa qua DoctorDepartment) nên được hợp nhất
 * thành 1 module duy nhất thay vì tách rời như trước.
 */
@Module({
  controllers: [
    PatientController,
    PatientContactController,
    DoctorDepartmentController,
    DoctorScheduleController,
    AppointmentSlotController,
    AppointmentController,
    QueueTicketController,
  ],
  providers: [
    PatientService,
    PatientContactService,
    DoctorDepartmentService,
    DoctorScheduleService,
    AppointmentSlotService,
    AppointmentService,
    QueueTicketService,
    WeeklyScheduleGenCron,
    ExpireSlotsCron,
  ],
  exports: [
    PatientService,
    PatientContactService,
    DoctorDepartmentService,
    DoctorScheduleService,
    AppointmentSlotService,
    AppointmentService,
    QueueTicketService,
  ],
})
export class AppointmentRegistrationModule {}
