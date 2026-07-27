import { FhirTransformStrategy } from '../interfaces/fhir-transform-strategy.interface';

export class ImagingStudyTransformStrategy implements FhirTransformStrategy {
    readonly tableName = 'imaging_studies';
    readonly resourceType = 'ImagingStudy';

    extractPatientId(row: any): string {
        return row.patient;
    }

    transform(row: any): Record<string, any> {
        const studyDate = row.obs_date || row.DATE;

        // 1. Build DICOM SOP Instance (Hình ảnh cụ thể / File DICOM)
        const instanceObj: Record<string, any> = {
            uid: row.instance_uid || `urn:uuid:${row.id}`,
            sopClass: {
                system: 'urn:ietf:rfc:3986',
                code: row.sop_code ? `urn:oid:${row.sop_code}` : 'urn:oid:1.2.840.10008.5.1.4.1.1.7', // Standard DICOM SOP Class fallback
            },
        };
        if (row.sop_description) {
            instanceObj.title = row.sop_description;
        }

        // 2. Build DICOM Series (Mảng chứa các ảnh cùng chuỗi chụp)
        const seriesObj: Record<string, any> = {
            uid: row.series_uid || `urn:uuid:${row.id}-series`,
            modality: {
                system: 'http://dicom.nema.org/resources/ontology/DCM',
                code: row.modality_code || 'UNKNOWN',
                display: row.modality_description || undefined,
            },
            instance: [instanceObj],
        };

        // Body Site (Vị trí cơ thể chụp: Ngực, Đầu, Chân, v.v.)
        if (row.bodysite_code || row.bodysite_description) {
            seriesObj.bodySite = {
                system: 'http://snomed.info/sct',
                code: row.bodysite_code || 'UNKNOWN',
                display: row.bodysite_description || undefined,
            };
        }

        if (studyDate) {
            seriesObj.started = studyDate;
        }

        // 3. Build FHIR ImagingStudy Resource
        const fhirImagingStudy: Record<string, any> = {
            resourceType: 'ImagingStudy',
            id: row.id,
            identifier: [
                {
                    system: 'http://hospital.org/imagingstudy-id',
                    value: row.id,
                },
            ],
            status: 'available', // Trạng thái ảnh DICOM đã sẵn sàng cho AI đọc
            subject: {
                reference: `Patient/${row.patient}`,
            },
            started: studyDate || undefined,
            series: [seriesObj],
        };

        // Link tới Đợt khám (Encounter Context)
        if (row.encounter) {
            fhirImagingStudy.encounter = {
                reference: `Encounter/${row.encounter}`,
            };
        }

        // Procedure Code (Loại thủ thuật / Chỉ định chụp)
        if (row.procedure_code) {
            fhirImagingStudy.procedureCode = [
                {
                    coding: [
                        {
                            system: 'http://snomed.info/sct',
                            code: row.procedure_code,
                        },
                    ],
                },
            ];
        }

        return fhirImagingStudy;
    }
}