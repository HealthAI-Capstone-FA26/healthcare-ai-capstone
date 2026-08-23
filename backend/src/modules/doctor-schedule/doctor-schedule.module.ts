import { Module } from '@nestjs/common';
import { DoctorScheduleController } from './doctor-schedule.controller';
import { DoctorScheduleService } from './doctor-schedule.service';
import { AppointmentSlotModule } from '../appointment-slot/appointment-slot.module';
import { WeeklyScheduleGenCron } from '../../common/cron/weekly-schedule-gen.cron';
import { ExpireSlotsCron } from '../../common/cron/expire-slots.cron';

@Module({
  imports: [AppointmentSlotModule],
  controllers: [DoctorScheduleController],
  providers: [
    DoctorScheduleService,
    WeeklyScheduleGenCron,
    ExpireSlotsCron,
  ],
  exports: [DoctorScheduleService],
})
export class DoctorScheduleModule {}
