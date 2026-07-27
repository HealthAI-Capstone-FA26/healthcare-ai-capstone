export interface FhirTransformStrategy {
    readonly tableName: string;
    readonly resourceType: string;

    // hospital_db row to fhir json
    transform(row: any): any;

    // call for the patient id for each row to isolate personal info by patient_id
    extractPatientId(row: any): string;
}