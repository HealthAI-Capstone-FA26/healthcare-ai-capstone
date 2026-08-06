import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Chỗ cấu hình database (chưa kết nối)
import { DatabaseModule } from './config/database.module';

// Các module nghiệp vụ (chỉ khung, chưa code)
import { PatientModule } from './modules/patient/patient.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { ProviderModule } from './modules/provider/provider.module';
import { PayerModule } from './modules/payer/payer.module';
import { PayerTransitionModule } from './modules/payer-transition/payer-transition.module';
import { EncounterModule } from './modules/encounter/encounter.module';
import { AllergyModule } from './modules/allergy/allergy.module';
import { CarePlanModule } from './modules/care-plan/care-plan.module';
import { ClaimModule } from './modules/claim/claim.module';
import { ClaimsTransactionModule } from './modules/claims-transaction/claims-transaction.module';
import { ConditionModule } from './modules/condition/condition.module';
import { DeviceModule } from './modules/device/device.module';
import { ImagingStudyModule } from './modules/imaging-study/imaging-study.module';
import { ImmunizationModule } from './modules/immunization/immunization.module';
import { MedicationModule } from './modules/medication/medication.module';
import { ObservationModule } from './modules/observation/observation.module';
import { ProcedureModule } from './modules/procedure/procedure.module';
import { SupplyModule } from './modules/supply/supply.module';

@Module({
  imports: [
    DatabaseModule,

    PatientModule,
    OrganizationModule,
    ProviderModule,
    PayerModule,
    PayerTransitionModule,
    EncounterModule,
    AllergyModule,
    CarePlanModule,
    ClaimModule,
    ClaimsTransactionModule,
    ConditionModule,
    DeviceModule,
    ImagingStudyModule,
    ImmunizationModule,
    MedicationModule,
    ObservationModule,
    ProcedureModule,
    SupplyModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
