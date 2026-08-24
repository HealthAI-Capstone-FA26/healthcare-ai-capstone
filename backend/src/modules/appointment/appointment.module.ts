import { Module } from '@nestjs/common';
import { PatientModule } from '../patient/patient.module';
import { AppointmentController } from './appointment.controller';
import { AppointmentService } from './appointment.service';
import { PatientConTactModule } from '../patientContact/patient-contact.module';
import { QueueTicketModule } from '../queue-ticket/queue-ticket.module';
@Module({
  imports: [PatientModule, PatientConTactModule, QueueTicketModule],
  controllers: [AppointmentController],
  providers: [AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentModule {}
