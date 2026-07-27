import { FhirTransformStrategy } from '../interfaces/fhir-transform-strategy.interface';

export class LabResultTransformStrategy implements FhirTransformStrategy {
    readonly tableName = 'observations_lab'; // Tên định danh strategy trong registry
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

        // 2. Build FHIR Observation Resource cho Lab Result
        const fhirObservation: Record<string, any> = {
            resourceType: 'Observation',
            id: row.id || `lab-${Date.now()}`,
            identifier: row.id
                ? [
                    {
                        system: 'http://hospital.org/observation-lab-id',
                        value: row.id,
                    },
                ]
                : undefined,
            status: 'final',
            // Category chuẩn cho Xét nghiệm y tế
            category: [
                {
                    coding: [
                        {
                            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
                            code: 'laboratory',
                            display: 'Laboratory',
                        },
                    ],
                },
            ],
            // Code LOINC / SNOMED của xét nghiệm (VD: Sinh hóa, Huyết học...)
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

        // Gán kết quả xét nghiệm (Dạng số hoặc dạng Chuỗi/Chữ)
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