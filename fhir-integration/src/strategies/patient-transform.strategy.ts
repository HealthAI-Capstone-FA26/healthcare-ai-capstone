import { FhirTransformStrategy } from '../interfaces/fhir-transform-strategy.interface';

export class PatientTransformStrategy implements FhirTransformStrategy {
    readonly tableName = 'patients';
    readonly resourceType = 'Patient';

    extractPatientId(row: any): string {
        return row.id;
    }

    transform(row: any): Record<string, any> {
        // 1. Xử lý Họ tên
        const givenNames: string[] = [];
        if (row.first) givenNames.push(row.first);
        if (row.middle) givenNames.push(row.middle);

        const nameObj: Record<string, any> = {
            use: 'official',
            family: row.last || '',
            given: givenNames,
        };
        if (row.prefix) nameObj.prefix = [row.prefix];
        if (row.suffix) nameObj.suffix = [row.suffix];

        const names = [nameObj];

        // Tên thời con gái (Maiden Name) nếu có
        if (row.maiden) {
            names.push({
                use: 'maiden',
                family: row.maiden,
            });
        }

        // 2. Xử lý Identifiers (ID Hospital, SSN, Drivers, Passport)
        const identifiers: any[] = [
            {
                system: 'http://hospital.org/patient-id',
                value: row.id,
            },
        ];

        if (row.ssn) {
            identifiers.push({
                type: {
                    coding: [
                        {
                            system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
                            code: 'SB',
                            display: 'Social Security Number',
                        },
                    ],
                },
                system: 'http://hl7.org/fhir/sid/us-ssn',
                value: row.ssn,
            });
        }

        if (row.drivers) {
            identifiers.push({
                type: {
                    coding: [
                        {
                            system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
                            code: 'DL',
                            display: "Driver's License",
                        },
                    ],
                },
                value: row.drivers,
            });
        }

        if (row.passport) {
            identifiers.push({
                type: {
                    coding: [
                        {
                            system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
                            code: 'PPN',
                            display: 'Passport Number',
                        },
                    ],
                },
                value: row.passport,
            });
        }

        // 3. Xử lý Địa chỉ (Address + Geolocation)
        const addressObj: Record<string, any> = {
            use: 'home',
            line: row.address ? [row.address] : [],
            city: row.city || '',
            district: row.county || '',
            state: row.state || '',
            postalCode: row.zip || '',
            country: 'US',
        };

        // Thêm tọa độ Lat/Lon vào Extension của Address
        if (row.lat !== undefined && row.lon !== undefined) {
            addressObj.extension = [
                {
                    url: 'http://hl7.org/fhir/StructureDefinition/geolocation',
                    extension: [
                        { url: 'latitude', valueDecimal: row.lat },
                        { url: 'longitude', valueDecimal: row.lon },
                    ],
                },
            ];
        }

        // 4. Map Gender chuẩn FHIR (male, female, other, unknown)
        let gender = 'unknown';
        if (row.gender === 'M' || row.gender === 'male') gender = 'male';
        else if (row.gender === 'F' || row.gender === 'female') gender = 'female';

        // 5. Build FHIR Resource hoàn chỉnh
        const fhirPatient: Record<string, any> = {
            resourceType: 'Patient',
            id: row.id,
            identifier: identifiers,
            name: names,
            gender: gender,
            birthDate: row.birthdate || undefined,
            address: [addressObj],
        };

        // Ngày mất (Deceased)
        if (row.deathdate) {
            fhirPatient.deceasedDateTime = row.deathdate;
        } else {
            fhirPatient.deceasedBoolean = false;
        }

        // Tình trạng hôn nhân (Marital Status)
        if (row.marital) {
            const maritalMap: Record<string, string> = {
                M: 'M', // Married
                S: 'S', // Never Married / Single
                D: 'D', // Divorced
                W: 'W', // Widowed
            };
            const code = maritalMap[row.marital] || 'UNK';
            fhirPatient.maritalStatus = {
                coding: [
                    {
                        system: 'http://terminology.hl7.org/CodeSystem/v3-MaritalStatus',
                        code: code,
                    },
                ],
            };
        }

        const extensions: any[] = [];

        if (row.birthplace) {
            extensions.push({
                url: 'http://hl7.org/fhir/StructureDefinition/patient-birthPlace',
                valueAddress: {
                    text: row.birthplace,
                },
            });
        }

        if (row.race) {
            extensions.push({
                url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-race',
                valueString: row.race,
            });
        }

        if (row.ethnicity) {
            extensions.push({
                url: 'http://hl7.org/fhir/us/core/StructureDefinition/us-core-ethnicity',
                valueString: row.ethnicity,
            });
        }

        if (extensions.length > 0) {
            fhirPatient.extension = extensions;
        }

        return fhirPatient;
    }
}