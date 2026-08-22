import { Module } from '@nestjs/common';
import { DoctorScheduleController } from './doctor-schedule.controller';
import { DoctorScheduleService } from './doctor-schedule.service';
import { AppointmentModule } from '../appointment/appointment.module';
import { WeeklyScheduleGenCron } from '../../common/cron/weekly-schedule-gen.cron';
import { ExpireSlotsCron } from '../../common/cron/expire-slots.cron';

@Module({
  imports: [AppointmentModule],
  controllers: [DoctorScheduleController],
  providers: [
    DoctorScheduleService,
    WeeklyScheduleGenCron,
    ExpireSlotsCron,
  ],
  exports: [DoctorScheduleService],
})
export class DoctorScheduleModule {}
