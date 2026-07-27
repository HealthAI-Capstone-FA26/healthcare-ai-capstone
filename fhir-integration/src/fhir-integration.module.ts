import { Module } from '@nestjs/common';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { FhirIntegrationService } from './fhir-integration.service';
import { FhirStrategyRegistry } from './registry/fhir-strategy.registry';

// Import đủ 8 Strategy
import { PatientTransformStrategy } from './strategies/patient-transform.strategy';
import { EncounterTransformStrategy } from './strategies/encounter-transform.strategy';
import { ImagingStudyTransformStrategy } from './strategies/imaging-study-transform.strategy';
import { VitalSignsTransformStrategy } from './strategies/vital-signs-transform.strategy';
import { LabResultTransformStrategy } from './strategies/lab-result-transform.strategy';
import { ConditionTransformStrategy } from './strategies/condition-transform.strategy';
import { MedicationTransformStrategy } from './strategies/medication-transform.strategy';
import { AllergyTransformStrategy } from './strategies/allergy-transform.strategy';

@Module({
    imports: [
        RabbitMQModule.forRoot({
            exchanges: [
                {
                    name: 'fhir_exchange',
                    type: 'topic',
                },
            ],
            uri: process.env.RABBITMQ_URI || 'amqp://rabbitmqadmin:12345678@localhost:5672',
            connectionInitOptions: { wait: false },
        }),
    ],
    providers: [
        FhirIntegrationService,
        FhirStrategyRegistry,
        PatientTransformStrategy,
        EncounterTransformStrategy,
        ImagingStudyTransformStrategy,
        VitalSignsTransformStrategy,
        LabResultTransformStrategy,
        ConditionTransformStrategy,
        MedicationTransformStrategy,
        AllergyTransformStrategy,
    ],
    exports: [FhirIntegrationService],
})
export class FhirIntegrationModule { }