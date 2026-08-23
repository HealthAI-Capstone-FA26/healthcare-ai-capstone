import { Module } from '@nestjs/common';
import { PatientContactController } from './patient-contact.controller';
import { PatientContactService } from './patient-contact.service';

@Module({
  controllers: [PatientContactController],
  providers: [PatientContactService],
  exports: [PatientContactService],
})
export class PatientConTactModule {}
