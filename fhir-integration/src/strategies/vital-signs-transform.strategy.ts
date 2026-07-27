import { FhirTransformStrategy } from '../interfaces/fhir-transform-strategy.interface';

export class VitalSignsTransformStrategy implements FhirTransformStrategy {
    readonly tableName = 'observations_vitals'; // Tên định danh strategy trong registry
    readonly resourceType = 'Observation';

    extractPatientId(row: any): string {
        return row.patient;
    }

    transform(row: any): Record<string, any> {
        const obsDate = row.obs_date || row.DATE;

        // 1. Phân tích giá trị (value) & Đơn vị (unit)
        let valueQuantity: Record<string, any> | undefined = undefined;

        if (row.value !== undefined && row.value !== null && row.value !== '') {
            const numValue = parseFloat(row.value);
            if (!isNaN(numValue)) {
                valueQuantity = {
                    value: numValue,
                    unit: row.units || undefined,
                    system: 'http://unitsofmeasure.org',
                    code: row.units || undefined,
                };
            }
        }

        // 2. Build FHIR Observation Resource cho Vital Signs
        const fhirObservation: Record<string, any> = {
            resourceType: 'Observation',
            id: row.id || `vital-${Date.now()}`,
            identifier: row.id
                ? [
                    {
                        system: 'http://hospital.org/observation-vital-id',
                        value: row.id,
                    },
                ]
                : undefined,
            status: 'final',
            // Category cố định là 'vital-signs' cho AI Sinh hiệu Worker
            category: [
                {
                    coding: [
                        {
                            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                            code: 'vital-signs',
                            display: 'Vital Signs',
                        },
                    ],
                },
            ],
            // Mã LOINC / SNOMED chỉ số sinh hiệu (Huyết áp, Nhịp tim, SpO2, Nhiệt độ...)
            code: {
                coding: [
                    {
                        system: 'http://loinc.org',
                        code: row.code || 'UNKNOWN',
                        display: row.description || undefined,
                    },
                ],
                text: row.description || undefined,
            },
            subject: {
                reference: `Patient/${row.patient}`,
            },
            effectiveDateTime: obsDate || undefined,
        };

        // Gán kết quả chỉ số sinh hiệu (Dạng số hoặc Chuỗi)
        if (valueQuantity) {
            fhirObservation.valueQuantity = valueQuantity;
        } else if (row.value) {
            fhirObservation.valueString = String(row.value);
        }

        // Link tới Đợt khám (Encounter Context)
        if (row.encounter) {
            fhirObservation.encounter = {
                reference: `Encounter/${row.encounter}`,
            };
        }

        return fhirObservation;
    }
}