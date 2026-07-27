import { FhirTransformStrategy } from '../interfaces/fhir-transform-strategy.interface';

export class ConditionTransformStrategy implements FhirTransformStrategy {
    readonly tableName = 'conditions';
    readonly resourceType = 'Condition';

    extractPatientId(row: any): string {
        return row.patient;
    }

    transform(row: any): Record<string, any> {
        const onsetDate = row.start_date || row.START;
        const abatementDate = row.stop_date || row.stop;

        // 1. Xác định Trạng thái Lâm sàng (Clinical Status: active vs resolved)
        // Nếu có stop_date -> bệnh đã khỏi (resolved), ngược lại -> đang điều trị (active)
        const clinicalStatusCode = abatementDate ? 'resolved' : 'active';
        const clinicalStatusDisplay = abatementDate ? 'Resolved' : 'Active';

        // 2. Xác định Hệ thống Mã Y tế (Code System: SNOMED CT / ICD-10 / ICD-9)
        let systemUri = 'http://snomed.info/sct'; // Mặc định là SNOMED-CT
        if (row.SYSTEM) {
            const rawSystem = String(row.SYSTEM).toUpperCase();
            if (rawSystem.includes('ICD10') || rawSystem.includes('ICD-10')) {
                systemUri = 'http://hl7.org/fhir/sid/icd-10';
            } else if (rawSystem.includes('ICD9') || rawSystem.includes('ICD-9')) {
                systemUri = 'http://hl7.org/fhir/sid/icd-9-cm';
            } else if (rawSystem.includes('SNOMED')) {
                systemUri = 'http://snomed.info/sct';
            }
        }

        // 3. Build FHIR Condition Resource
        const fhirCondition: Record<string, any> = {
            resourceType: 'Condition',
            id: row.id || `cond-${Date.now()}`,
            identifier: row.id
                ? [
                    {
                        system: 'http://hospital.org/condition-id',
                        value: row.id,
                    },
                ]
                : undefined,

            // Clinical Status (active / resolved)
            clinicalStatus: {
                coding: [
                    {
                        system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
                        code: clinicalStatusCode,
                        display: clinicalStatusDisplay,
                    },
                ],
            },

            // Verification Status (Bệnh đã được xác nhận)
            verificationStatus: {
                coding: [
                    {
                        system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status',
                        code: 'confirmed',
                        display: 'Confirmed',
                    },
                ],
            },

            // Category: Chẩn đoán lâm sàng (encounter-diagnosis)
            category: [
                {
                    coding: [
                        {
                            system: 'http://terminology.hl7.org/CodeSystem/condition-category',
                            code: 'encounter-diagnosis',
                            display: 'Encounter Diagnosis',
                        },
                    ],
                },
            ],

            // Mã Bệnh lý & Mô tả (ICD-10 / SNOMED CT)
            code: {
                coding: [
                    {
                        system: systemUri,
                        code: row.code || 'UNKNOWN',
                        display: row.description || undefined,
                    },
                ],
                text: row.description || undefined,
            },

            // Bệnh nhân (Patient Reference)
            subject: {
                reference: `Patient/${row.patient}`,
            },

            // Thời điểm bắt đầu bị bệnh
            onsetDateTime: onsetDate || undefined,
        };

        // Thời điểm khỏi bệnh / kết thúc
        if (abatementDate) {
            fhirCondition.abatementDateTime = abatementDate;
        }

        // Link tới Đợt khám tương ứng (Encounter Reference)
        if (row.encounter) {
            fhirCondition.encounter = {
                reference: `Encounter/${row.encounter}`,
            };
        }

        return fhirCondition;
    }
}