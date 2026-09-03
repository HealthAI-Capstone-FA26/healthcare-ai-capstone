import { Module } from '@nestjs/common';

import { EncounterController } from './encounter/encounter.controller';
import { EncounterService } from './encounter/encounter.service';

import { ChiefComplaintController } from './chief-complaint/chief-complaint.controller';
import { ChiefComplaintService } from './chief-complaint/chief-complaint.service';

import { IdentityVerificationController } from './identity-verification/identity-verification.controller';
import { IdentityVerificationService } from './identity-verification/identity-verification.service';

/**
 * Gom domain nghiệp vụ Tiếp đón & Đăng ký khám (Module 3): Encounter, ChiefComplaint,
 * PatientIdentityVerification, Consent/ConsentPolicy, PatientAllergy, PatientMedicalHistory,
 * DoctorQueueEntry sẽ được thêm dần theo từng phase (xem module3-implementation-plan.md).
 *
 * EncounterService được export để QueueTicketService (module appointment-registration) gọi
 * `createFromCheckin` ngay trong bước `done()` — AppointmentRegistrationModule import module này,
 * chiều phụ thuộc chỉ 1 chiều (reception-intake không phụ thuộc ngược lại appointment-registration)
 * nên không phát sinh circular dependency.
 */
@Module({
  controllers: [EncounterController, ChiefComplaintController, IdentityVerificationController],
  providers: [EncounterService, ChiefComplaintService, IdentityVerificationService],
  exports: [EncounterService],
})
export class ReceptionIntakeModule { }