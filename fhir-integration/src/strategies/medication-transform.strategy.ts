import { FhirTransformStrategy } from '../interfaces/fhir-transform-strategy.interface';

export class MedicationTransformStrategy implements FhirTransformStrategy {
    readonly tableName = 'medications';
    readonly resourceType = 'MedicationRequest';

    extractPatientId(row: any): string {
        return row.patient;
    }

    transform(row: any): Record<string, any> {
        const startTime = row.start_time || row.START;
        const stopTime = row.stop_time || row.stop;

        // 1. Trạng thái đơn thuốc (status)
        // Nếu đã ngừng/hết thời gian cấp thuốc -> completed, ngược lại -> active
        const status = stopTime ? 'completed' : 'active';

        // 2. Build FHIR MedicationRequest Resource
        const fhirMedicationRequest: Record<string, any> = {
            resourceType: 'MedicationRequest',
            id: row.id || `med-${Date.now()}`,
            identifier: row.id
                ? [
                    {
                        system: 'http://hospital.org/medication-id',
                        value: row.id,
                    },
                ]
                : undefined,
            status: status,
            intent: 'order', // Chỉ định kê đơn

            // Mã Thuốc & Tên Thuốc (RxNorm / SNOMED CT)
            medicationCodeableConcept: {
                coding: [
                    {
                        system: 'http://www.nlm.nih.gov/research/umls/rxnorm',
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

            // Ngày kê đơn / Bắt đầu dùng
            authoredOn: startTime || undefined,
        };

        // 3. Ngữ cảnh Đợt khám (Encounter)
        if (row.encounter) {
            fhirMedicationRequest.encounter = {
                reference: `Encounter/${row.encounter}`,
            };
        }

        // 4. Lý do kê đơn (Reason Code / Description)
        if (row.reasoncode || row.reasondescription) {
            fhirMedicationRequest.reasonCode = [
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

        // 5. Thông tin Cấp phát Thuốc (Dispense Request)
        if (row.dispenses !== undefined || stopTime) {
            const dispenseRequest: Record<string, any> = {};

            if (row.dispenses !== undefined) {
                dispenseRequest.numberOfRepeatsAllowed = parseInt(row.dispenses, 10) || 1;
            }

            if (startTime || stopTime) {
                dispenseRequest.validityPeriod = {
                    start: startTime || undefined,
                    end: stopTime || undefined,
                };
            }

            fhirMedicationRequest.dispenseRequest = dispenseRequest;
        }

        // 6. Extensions cho Chi phí Thuốc & Bảo hiểm (Payer, Costs)
        const extensions: any[] = [];

        if (row.payer) {
            extensions.push({
                url: 'http://hospital.org/fhir/StructureDefinition/medication-payer',
                valueReference: {
                    reference: `Coverage/${row.payer}`,
                },
            });
        }

        if (row.base_cost !== undefined) {
            extensions.push({
                url: 'http://hospital.org/fhir/StructureDefinition/medication-base-cost',
                valueMoney: {
                    value: parseFloat(row.base_cost),
                    currency: 'USD',
                },
            });
        }

        if (row.totalcost !== undefined) {
            extensions.push({
                url: 'http://hospital.org/fhir/StructureDefinition/medication-total-cost',
                valueMoney: {
                    value: parseFloat(row.totalcost),
                    currency: 'USD',
                },
            });
        }

        if (row.payer_coverage !== undefined) {
            extensions.push({
                url: 'http://hospital.org/fhir/StructureDefinition/medication-payer-coverage',
                valueMoney: {
                    value: parseFloat(row.payer_coverage),
                    currency: 'USD',
                },
            });
        }

        if (extensions.length > 0) {
            fhirMedicationRequest.extension = extensions;
        }

        return fhirMedicationRequest;
    }
}