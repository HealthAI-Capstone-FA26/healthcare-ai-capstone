import { Module } from '@nestjs/common';
import { AppointmentSlotController } from './appointment-slot.controller';
import { AppointmentSlotService } from './appointment-slot.service';

@Module({
  controllers: [AppointmentSlotController],
  providers: [AppointmentSlotService],
  exports: [AppointmentSlotService],
})
export class AppointmentSlotModule {}
