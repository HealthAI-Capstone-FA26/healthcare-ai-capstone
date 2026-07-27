import { FhirTransformStrategy } from '../interfaces/fhir-transform-strategy.interface';

export class EncounterTransformStrategy implements FhirTransformStrategy {
    readonly tableName = 'encounters';
    readonly resourceType = 'Encounter';

    extractPatientId(row: any): string {
        return row.patient;
    }

    transform(row: any): Record<string, any> {
        const startTime = row.start_time || row.START;
        const stopTime = row.stop_time || row.stop;

        // 1. Map Encounter Class (inpatient, outpatient, emergency, ambulatory, v.v.)
        // FHIR Class coding: http://terminology.hl7.org/CodeSystem/v3-ActCode
        const encounterClassMap: Record<string, { code: string; display: string }> = {
            inpatient: { code: 'IMP', display: 'inpatient encounter' },
            outpatient: { code: 'AMB', display: 'ambulatory' },
            emergency: { code: 'EMER', display: 'emergency' },
            ambulatory: { code: 'AMB', display: 'ambulatory' },
            wellness: { code: 'WELL', display: 'wellness' },
            urgentcare: { code: 'VR', display: 'virtual' },
        };

        const rawClass = (row.encounterclass || 'outpatient').toLowerCase();
        const classInfo = encounterClassMap[rawClass] || {
            code: 'AMB',
            display: 'ambulatory',
        };

        // 2. Map Status dựa vào thời gian kết thúc (if stop_time exists -> finished, else -> in-progress)
        const status = stopTime ? 'finished' : 'in-progress';

        // 3. Build FHIR Encounter Resource
        const fhirEncounter: Record<string, any> = {
            resourceType: 'Encounter',
            id: row.id,
            identifier: [
                {
                    system: 'http://hospital.org/encounter-id',
                    value: row.id,
                },
            ],
            status: status,
            class: {
                system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
                code: classInfo.code,
                display: classInfo.display,
            },
            subject: {
                reference: `Patient/${row.patient}`,
            },
            period: {
                start: startTime || undefined,
                end: stopTime || undefined,
            },
        };

        // 4. Reason Code / Reason Description (Lý do khám bệnh)
        if (row.reasoncode || row.reasondescription) {
            fhirEncounter.reasonCode = [
                {
                    coding: [
                        {
                            system: 'http://snomed.info/sct',
                            code: row.reasoncode || 'UNKNOWN',
                            display: row.reasondescription || undefined,
                        },
                    ],
                    text: row.reasondescription || undefined,
                },
            ];
        }

        // 5. Encounter Code & Description (Loại hình đợt khám / Loại dịch vụ)
        if (row.code || row.description) {
            fhirEncounter.type = [
                {
                    coding: [
                        {
                            system: 'http://snomed.info/sct',
                            code: row.code || 'UNKNOWN',
                            display: row.description || undefined,
                        },
                    ],
                    text: row.description || undefined,
                },
            ];
        }

        // 6. Service Provider & Bác sĩ (Provider / Organization)
        if (row.provider) {
            fhirEncounter.participant = [
                {
                    individual: {
                        reference: `Practitioner/${row.provider}`,
                    },
                },
            ];
        }

        if (row.organization) {
            fhirEncounter.serviceProvider = {
                reference: `Organization/${row.organization}`,
            };
        }

        // 7. Extensions cho Tài chính & Báo hiểm (Payer, Costs, Coverage)
        const extensions: any[] = [];

        if (row.payer) {
            extensions.push({
                url: 'http://hospital.org/fhir/StructureDefinition/encounter-payer',
                valueReference: {
                    reference: `Coverage/${row.payer}`,
                },
            });
        }

        if (row.base_encounter_cost !== undefined) {
            extensions.push({
                url: 'http://hospital.org/fhir/StructureDefinition/base-encounter-cost',
                valueMoney: {
                    value: parseFloat(row.base_encounter_cost),
                    currency: 'USD',
                },
            });
        }

        if (row.total_claim_cost !== undefined) {
            extensions.push({
                url: 'http://hospital.org/fhir/StructureDefinition/total-claim-cost',
                valueMoney: {
                    value: parseFloat(row.total_claim_cost),
                    currency: 'USD',
                },
            });
        }

        if (row.payer_coverage !== undefined) {
            extensions.push({
                url: 'http://hospital.org/fhir/StructureDefinition/payer-coverage',
                valueMoney: {
                    value: parseFloat(row.payer_coverage),
                    currency: 'USD',
                },
            });
        }

        if (extensions.length > 0) {
            fhirEncounter.extension = extensions;
        }

        return fhirEncounter;
    }
}