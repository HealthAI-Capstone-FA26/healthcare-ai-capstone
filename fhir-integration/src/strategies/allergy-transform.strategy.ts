import { FhirTransformStrategy } from '../interfaces/fhir-transform-strategy.interface';

export class AllergyTransformStrategy implements FhirTransformStrategy {
    readonly tableName = 'allergies';
    readonly resourceType = 'AllergyIntolerance';

    extractPatientId(row: any): string {
        return row.patient;
    }

    transform(row: any): Record<string, any> {
        const onsetDate = row.start_date || row.START;
        const abatementDate = row.stop_date || row.stop;

        // 1. Trạng thái Lâm sàng (Clinical Status: active vs resolved)
        const clinicalStatusCode = abatementDate ? 'resolved' : 'active';
        const clinicalStatusDisplay = abatementDate ? 'Resolved' : 'Active';

        // 2. Xác định Hệ thống Mã Dị ứng (SNOMED-CT / RxNorm / ICD-10)
        let systemUri = 'http://snomed.info/sct';
        if (row.system || row.SYSTEM) {
            const rawSystem = String(row.system || row.SYSTEM).toUpperCase();
            if (rawSystem.includes('RXNORM')) {
                systemUri = 'http://www.nlm.nih.gov/research/umls/rxnorm';
            } else if (rawSystem.includes('ICD10') || rawSystem.includes('ICD-10')) {
                systemUri = 'http://hl7.org/fhir/sid/icd-10';
            } else if (rawSystem.includes('SNOMED')) {
                systemUri = 'http://snomed.info/sct';
            }
        }

        // 3. Phân loại Dị ứng (category: food, medication, environment, biologic)
        let categories: string[] = ['medication']; // Mặc định là thuốc
        if (row.category) {
            const catLower = String(row.category).toLowerCase();
            if (['food', 'medication', 'environment', 'biologic'].includes(catLower)) {
                categories = [catLower];
            }
        }

        // 4. Phân loại Loại hình Dị ứng (type: allergy vs intolerance)
        const allergyType = row.type ? String(row.type).toLowerCase() : 'allergy';

        // 5. Xử lý Phản ứng (Reactions: reaction1, reaction2)
        const reactions: any[] = [];

        // Phản ứng 1
        if (row.reaction1 || row.description1) {
            const r1: Record<string, any> = {
                manifestation: [
                    {
                        coding: [
                            {
                                system: 'http://snomed.info/sct',
                                code: row.reaction1 || 'UNKNOWN',
                                display: row.description1 || undefined,
                            },
                        ],
                        text: row.description1 || undefined,
                    },
                ],
            };
            if (row.severity1) {
                r1.severity = String(row.severity1).toLowerCase(); // mild, moderate, severe
            }
            reactions.push(r1);
        }

        // Phản ứng 2
        if (row.reaction2 || row.description2) {
            const r2: Record<string, any> = {
                manifestation: [
                    {
                        coding: [
                            {
                                system: 'http://snomed.info/sct',
                                code: row.reaction2 || 'UNKNOWN',
                                display: row.description2 || undefined,
                            },
                        ],
                        text: row.description2 || undefined,
                    },
                ],
            };
            if (row.severity2) {
                r2.severity = String(row.severity2).toLowerCase();
            }
            reactions.push(r2);
        }

        // 6. Build FHIR AllergyIntolerance Resource
        const fhirAllergy: Record<string, any> = {
            resourceType: 'AllergyIntolerance',
            id: row.id || `allergy-${Date.now()}`,
            identifier: row.id
                ? [
                    {
                        system: 'http://hospital.org/allergy-id',
                        value: row.id,
                    },
                ]
                : undefined,

            // Clinical Status (active / resolved)
            clinicalStatus: {
                coding: [
                    {
                        system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical',
                        code: clinicalStatusCode,
                        display: clinicalStatusDisplay,
                    },
                ],
            },

            // Verification Status (Đã xác nhận)
            verificationStatus: {
                coding: [
                    {
                        system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification',
                        code: 'confirmed',
                        display: 'Confirmed',
                    },
                ],
            },

            type: allergyType, // allergy | intolerance
            category: categories, // food | medication | environment

            // Tác nhân gây dị ứng (Substance / Code)
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

            // Bệnh nhân (Subject)
            subject: {
                reference: `Patient/${row.patient}`,
            },

            onsetDateTime: onsetDate || undefined,
        };

        // Ngày kết thúc / Hết dị ứng
        if (abatementDate) {
            fhirAllergy.abatementDateTime = abatementDate;
        }

        // Link tới Đợt khám (Encounter)
        if (row.encounter) {
            fhirAllergy.encounter = {
                reference: `Encounter/${row.encounter}`,
            };
        }

        // Gắn mảng phản ứng (Reactions) nếu có
        if (reactions.length > 0) {
            fhirAllergy.reaction = reactions;
        }

        return fhirAllergy;
    }
}