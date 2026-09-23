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

import { TriageQueueController } from './triage-queue/triage-queue.controller';
import { TriageQueueService } from './triage-queue/triage-queue.service';

/**
 * Gom domain nghiệp vụ Tiếp đón & Đăng ký khám (Module 3): Encounter, ChiefComplaint,
 * PatientIdentityVerification, Consent/ConsentPolicy, PatientAllergy, PatientMedicalHistory,
 * TriageQueueEntry. `EncounterService.completeRegistration` (module3.md mục 5 PHASE 1-2) đã
 * implement: kiểm tra đủ điều kiện tiếp đón, chuyển Encounter arrived -> registered và xếp vào
 * hàng đợi triage qua TriageQueueService.enqueue, nối sang module vitals ở giai đoạn sau.
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
    TriageQueueController,
  ],
  providers: [
    EncounterService,
    ChiefComplaintService,
    IdentityVerificationService,
    ConsentService,
    ConsentPolicyService,
    PatientAllergyService,
    PatientMedicalHistoryService,
    TriageQueueService,
  ],
  exports: [EncounterService, TriageQueueService], // TriageQueueService: module vitals gọi complete() trong transaction ghi sinh hiệu
})
export class ReceptionIntakeModule { }