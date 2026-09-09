import { Module } from '@nestjs/common';

import { EncounterController } from './encounter/encounter.controller';
import { EncounterService } from './encounter/encounter.service';

import { ChiefComplaintController } from './chief-complaint/chief-complaint.controller';
import { ChiefComplaintService } from './chief-complaint/chief-complaint.service';

import { IdentityVerificationController } from './identity-verification/identity-verification.controller';
import { IdentityVerificationService } from './identity-verification/identity-verification.service';

import { ConsentController } from './consent/consent.controller';
import { ConsentService } from './consent/consent.service';
import { ConsentPolicyController } from './consent/consent-policy.controller';
import { ConsentPolicyService } from './consent/consent-policy.service';

import { PatientAllergyController } from './patient-history/patient-allergy.controller';
import { PatientAllergyService } from './patient-history/patient-allergy.service';
import { PatientMedicalHistoryController } from './patient-history/patient-medical-history.controller';
import { PatientMedicalHistoryService } from './patient-history/patient-medical-history.service';

/**
 * Gom domain nghiệp vụ Tiếp đón & Đăng ký khám (Module 3): Encounter, ChiefComplaint,
 * PatientIdentityVerification, Consent/ConsentPolicy, PatientAllergy, PatientMedicalHistory.
 * DoctorQueueEntry và bước orchestration complete-registration (Phase 6-7) sẽ thêm sau (xem
 * module3-implementation-plan.md).
 *
 * EncounterService được export để QueueTicketService (module appointment-registration) gọi
 * `createFromCheckin` ngay trong bước `done()` — AppointmentRegistrationModule import module này,
 * chiều phụ thuộc chỉ 1 chiều (reception-intake không phụ thuộc ngược lại appointment-registration)
 * nên không phát sinh circular dependency.
 */
@Module({
  controllers: [
    EncounterController,
    ChiefComplaintController,
    IdentityVerificationController,
    ConsentController,
    ConsentPolicyController,
    PatientAllergyController,
    PatientMedicalHistoryController,
  ],
  providers: [
    EncounterService,
    ChiefComplaintService,
    IdentityVerificationService,
    ConsentService,
    ConsentPolicyService,
    PatientAllergyService,
    PatientMedicalHistoryService,
  ],
  exports: [EncounterService],
})
export class ReceptionIntakeModule { }