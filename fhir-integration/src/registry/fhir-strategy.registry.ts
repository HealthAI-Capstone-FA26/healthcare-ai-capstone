// src/fhir-integration/registry/fhir-strategy.registry.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { FhirTransformStrategy } from '../interfaces/fhir-transform-strategy.interface';
import { PatientTransformStrategy } from '../strategies/patient-transform.strategy';
import { EncounterTransformStrategy } from '../strategies/encounter-transform.strategy';
import { ImagingStudyTransformStrategy } from '../strategies/imaging-study-transform.strategy';
import { VitalSignsTransformStrategy } from '../strategies/vital-signs-transform.strategy';
import { LabResultTransformStrategy } from '../strategies/lab-result-transform.strategy';
import { ConditionTransformStrategy } from '../strategies/condition-transform.strategy';
import { MedicationTransformStrategy } from '../strategies/medication-transform.strategy';
import { AllergyTransformStrategy } from '../strategies/allergy-transform.strategy';

@Injectable()
export class FhirStrategyRegistry implements OnModuleInit {
    private strategies = new Map<string, FhirTransformStrategy>();

    constructor(
        private readonly patientStrategy: PatientTransformStrategy,
        private readonly encounterStrategy: EncounterTransformStrategy,
        private readonly imagingStrategy: ImagingStudyTransformStrategy,
        private readonly vitalSignsStrategy: VitalSignsTransformStrategy,
        private readonly labResultStrategy: LabResultTransformStrategy,
        private readonly conditionStrategy: ConditionTransformStrategy,
        private readonly medicationStrategy: MedicationTransformStrategy,
        private readonly allergyStrategy: AllergyTransformStrategy,
    ) { }

    onModuleInit() {
        // Đăng ký tường minh các strategy ứng với tableName
        this.register(this.patientStrategy);
        this.register(this.encounterStrategy);
        this.register(this.imagingStrategy);
        this.register(this.vitalSignsStrategy);
        this.register(this.labResultStrategy);
        this.register(this.conditionStrategy);
        this.register(this.medicationStrategy);
        this.register(this.allergyStrategy);
    }

    register(strategy: FhirTransformStrategy) {
        this.strategies.set(strategy.tableName, strategy);
    }

    getStrategy(tableName: string): FhirTransformStrategy | undefined {
        return this.strategies.get(tableName);
    }
}