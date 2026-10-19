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

import { QueueTicketController } from './queue-ticket/queue-ticket.controller';
import { QueueTicketService } from './queue-ticket/queue-ticket.service';

import { PatientController } from './patient/patient.controller';
import { PatientService } from './patient/patient.service';

import { WeeklyScheduleGenCron } from '../../common/cron/weekly-schedule-gen.cron';
import { ExpireSlotsCron } from '../../common/cron/expire-slots.cron';
import { CleanupDraftPatientsCron } from '../../common/cron/cleanup-draft-patients.cron';

import { ReceptionIntakeModule } from '../reception-intake/reception-intake.module';
import { UserModule } from '../user/user.module';
import { PaymentModule } from '../payment/payment.module'; // InvoiceService: tự lập hoá đơn phí khám ở QueueTicketService.done()

/**
 * Gom toàn bộ domain nghiệp vụ đăng ký khám (Module 2 — Đăng ký khám chữa bệnh):
 * Patient, DoctorSchedule, AppointmentSlot, Appointment, QueueTicket. Các domain này phụ thuộc chặt
 * vào nhau (DoctorSchedule sinh AppointmentSlot, AppointmentSlot được Appointment đặt, Appointment
 * walk-in sinh QueueTicket) nên được hợp nhất thành 1 module duy nhất.
 *
 * Schema v2: hệ thống chỉ phục vụ 1 chuyên khoa Tim mạch -> không còn Department / DoctorDepartment /
 * StaffDepartment / gợi ý khoa theo triệu chứng (mỗi tài khoản gắn tối đa 1 hồ sơ qua Patient.userId).
 *
 * Import ReceptionIntakeModule (Module 3) để QueueTicketService gọi được EncounterService
 * ngay tại bước done() — xem comment trong ReceptionIntakeModule.
 */
@Module({
  imports: [ReceptionIntakeModule, UserModule, PaymentModule],
  controllers: [
    PatientController,
    DoctorScheduleController,
    AppointmentSlotController,
    AppointmentController,
    GuestAppointmentController,
    QueueTicketController,
  ],
  providers: [
    PatientService,
    DoctorScheduleService,
    AppointmentSlotService,
    AppointmentService,
    GuestAppointmentService,
    GuestAppointmentOtpStore,
    QueueTicketService,
    WeeklyScheduleGenCron,
    ExpireSlotsCron,
    CleanupDraftPatientsCron,
  ],
  exports: [
    PatientService,
    DoctorScheduleService,
    AppointmentSlotService,
    AppointmentService,
    QueueTicketService,
  ],
})
export class AppointmentRegistrationModule { }