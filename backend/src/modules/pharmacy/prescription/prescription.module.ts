import { Module } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { DoctorModule } from '../../identity-access/doctor/doctor.module';
import { UserModule } from '../../identity-access/user/user.module';
import { PrescriptionController } from './prescription.controller';
import { PrescriptionService } from './prescription.service';
import { AllergyContraindicationDetector } from './prescription-safety/detectors/allergy-contraindication.detector';
import { DuplicateTherapeuticClassDetector } from './prescription-safety/detectors/duplicate-therapeutic-class.detector';
import { PrescriptionSafetyCheckOrchestrator } from './prescription-safety/orchestrators/prescription-safety-check.orchestrator';

@Module({
  imports: [DoctorModule, UserModule],
  controllers: [PrescriptionController],
  providers: [
    PrismaService,
    PrescriptionService,
    AllergyContraindicationDetector,
    DuplicateTherapeuticClassDetector,
    PrescriptionSafetyCheckOrchestrator,
  ],
  exports: [PrescriptionService],
})
export class PrescriptionModule {}
