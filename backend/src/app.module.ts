import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { MailModule } from './modules/platform/mail/mail.module';
import { SmsModule } from './modules/platform/sms/sms.module';
import { NotificationModule } from './modules/platform/notification/notification.module';
import { AuthModule } from './modules/identity-access/auth/auth.module';
import { UserModule } from './modules/identity-access/user/user.module';
import { DoctorModule } from './modules/identity-access/doctor/doctor.module';
import { AppointmentRegistrationModule } from './modules/patient-flow/appointment-registration/appointment-registration.module';
import { ReceptionIntakeModule } from './modules/patient-flow/reception-intake/reception-intake.module';
import { RolePermissionModule } from './modules/identity-access/auth/role-permission/role-permission.module';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { VitalModule } from './modules/clinical/vitals/vital.module';
import { LabTestModule } from './modules/lab-test/lab-test.module';
import { Icd10CatalogModule } from './modules/clinical/icd10-catalog/icd10-catalog.module';
import { DoctorExaminationModule } from './modules/clinical/pre-doctor-examination/doctor-examination.module';
import { PaymentModule } from './modules/payment/payment.module';
import { PostTestConsultationModule } from './modules/clinical/post-test-consultation/post-test-consultation.module';
import { PrescriptionModule } from './modules/pharmacy/prescription/prescription.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    PrismaModule,
    RedisModule,
    MailModule,
    SmsModule,
    NotificationModule,
    AuthModule,
    UserModule,
    DoctorModule,
    AppointmentRegistrationModule,
    ReceptionIntakeModule,
    RolePermissionModule,
    VitalModule,
    LabTestModule,
    Icd10CatalogModule,
    DoctorExaminationModule,
    PaymentModule,
    PostTestConsultationModule,
    PrescriptionModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }