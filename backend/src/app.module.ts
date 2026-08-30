import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { MailModule } from './modules/mail/mail.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { DoctorModule } from './modules/doctor/doctor.module';
import { AppointmentRegistrationModule } from './modules/appointment-registration/appointment-registration.module';
import { ReceptionIntakeModule } from './modules/reception-intake/reception-intake.module';
import { RolePermissionModule } from './modules/auth/role-permission/role-permission.module';
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    RedisModule,
    MailModule,
    AuthModule,
    UserModule,
    DoctorModule,
    AppointmentRegistrationModule,
    ReceptionIntakeModule,
    RolePermissionModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }