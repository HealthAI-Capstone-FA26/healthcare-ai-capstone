import { NestFactory } from '@nestjs/core';
import { FhirIntegrationModule } from './fhir-integration.module';
import { FhirIntegrationService } from './fhir-integration.service';
import { FhirStrategyRegistry } from './registry/fhir-strategy.registry';

async function bootstrap() {
  // 1. Tạo Nest Application Context
  const app = await NestFactory.createApplicationContext(FhirIntegrationModule);

  const fhirService = app.get(FhirIntegrationService);
  const strategyRegistry = app.get(FhirStrategyRegistry);

  console.log('🚀 [FHIR Integration] Đang khởi tạo pipeline test 8 Strategy...');

  // ==========================================
  // 📋 DỮ LIỆU GIẢ LẬP CHO TỪNG BẢNG (8 STRATEGY)
  // ==========================================

  const testDatasets: Record<string, { tableName: string; data: any[] }> = {
    // 1. Patients
    patients: {
      tableName: 'patients',
      data: [
        {
          id: 'p-001',
          birthdate: '1988-04-12',
          deathdate: null,
          ssn: '900-12-3456',
          drivers: 'S99912345',
          passport: 'P123456789',
          prefix: 'Mr.',
          first: 'John',
          middle: 'Edward',
          last: 'Doe',
          suffix: 'Jr.',
          marital: 'M',
          race: 'white',
          ethnicity: 'nonhispanic',
          gender: 'M',
          birthplace: 'Boston, Massachusetts, US',
          address: '123 Main Street',
          city: 'Boston',
          state: 'MA',
          county: 'Suffolk County',
          zip: '02108',
          lat: 42.35843,
          lon: -71.05977,
        },
      ],
    },

    // 2. Encounters
    encounters: {
      tableName: 'encounters',
      data: [
        {
          id: 'enc-001',
          start_time: '2026-05-01T08:00:00Z',
          stop_time: '2026-05-01T09:30:00Z',
          patient: 'p-001',
          encounterclass: 'outpatient',
          code: '185349003',
          description: 'Encounter for check-up',
          base_encounter_cost: 150.0,
          total_claim_cost: 200.0,
        },
      ],
    },

    // 3. Imaging Studies
    imaging_studies: {
      tableName: 'imaging_studies',
      data: [
        {
          id: 'img-001',
          obs_date: '2026-05-01T08:30:00Z',
          patient: 'p-001',
          encounter: 'enc-001',
          series_uid: '1.2.840.113619.2.55.3',
          bodysite_code: '39607008',
          bodysite_description: 'Lung structure',
          modality_code: 'CR',
          modality_description: 'Computed Radiography',
          instance_uid: '1.2.840.113619.2.55.3.1',
          sop_code: '1.2.840.10008.5.1.4.1.1.1',
          sop_description: 'Digital X-Ray Image',
        },
      ],
    },

    // 4. Vital Signs (Observations)
    observations_vitals: {
      tableName: 'observations_vitals',
      data: [
        {
          id: 'vit-001',
          obs_date: '2026-05-01T08:15:00Z',
          patient: 'p-001',
          encounter: 'enc-001',
          category: 'vital-signs',
          code: '8837-1',
          description: 'Heart rate',
          value: '75',
          units: 'beats/min',
        },
      ],
    },

    // 5. Lab Results (Observations)
    observations_lab: {
      tableName: 'observations_lab',
      data: [
        {
          id: 'lab-001',
          obs_date: '2026-05-01T08:20:00Z',
          patient: 'p-001',
          encounter: 'enc-001',
          category: 'laboratory',
          code: '2339-0',
          description: 'Glucose [Mass/volume] in Blood',
          value: '95',
          units: 'mg/dL',
        },
      ],
    },

    // 6. Conditions
    conditions: {
      tableName: 'conditions',
      data: [
        {
          id: 'cond-001',
          start_date: '2026-01-10',
          stop_date: null,
          patient: 'p-001',
          encounter: 'enc-001',
          code: '44054006',
          description: 'Diabetes mellitus type 2',
          SYSTEM: 'SNOMED-CT',
        },
      ],
    },

    // 7. Medications
    medications: {
      tableName: 'medications',
      data: [
        {
          id: 'med-001',
          start_time: '2026-05-01T09:00:00Z',
          stop_time: null,
          patient: 'p-001',
          encounter: 'enc-001',
          code: '860975',
          description: 'Metformin 500 MG Oral Tablet',
          base_cost: 15.0,
          total_claim_cost: 15.0,
          dispenses: 3,
        },
      ],
    },

    // 8. Allergies
    allergies: {
      tableName: 'allergies',
      data: [
        {
          id: 'alg-001',
          start_date: '2020-05-15',
          stop_date: null,
          patient: 'p-001',
          encounter: 'enc-001',
          code: '70618',
          system: 'RxNorm',
          description: 'Penicillin',
          category: 'medication',
          type: 'allergy',
          reaction1: '39579001',
          description1: 'Anaphylaxis',
          severity1: 'severe',
        },
      ],
    },
  };

  // ==========================================
  // 🔍 PREVIEW & TEST TỪNG STRATEGY RA CONSOLE
  // ==========================================

  console.log('\n=================== 📄 PREVIEW ALL 8 FHIR STRATEGIES ===================');

  for (const [key, item] of Object.entries(testDatasets)) {
    const strategy = strategyRegistry.getStrategy(item.tableName);
    if (strategy) {
      console.log(`\n🔹 [Strategy Target: ${strategy.resourceType} | Table: ${item.tableName}]`);
      item.data.forEach((row, idx) => {
        const transformed = strategy.transform(row);
        console.log(JSON.stringify(transformed, null, 2));
      });
    } else {
      console.warn(`⚠️ Không tìm thấy strategy cho bảng: ${item.tableName}`);
    }
  }

  console.log('\n=========================================================================\n');

  // ==========================================
  // 🚀 THỰC THI PIPELINE (Transform & Publish RabbitMQ)
  // ==========================================
  console.log('📡 Đang bắt đầu đẩy dữ liệu qua Pipeline (RabbitMQ)...');

  for (const [key, item] of Object.entries(testDatasets)) {
    await fhirService.processAndPublish(item.tableName, item.data);
  }

  console.log('✅ [FHIR Integration] Đã xử lý xong toàn bộ 8 pipeline. Đóng service...');

  // 4. Đóng kết nối gọn gàng
  await app.close();
}

bootstrap();