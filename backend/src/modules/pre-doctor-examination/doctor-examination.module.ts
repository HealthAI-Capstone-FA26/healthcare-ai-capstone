import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { UserModule } from '../user/user.module';
import { DoctorModule } from '../doctor/doctor.module';
import { Icd10CatalogModule } from '../shared/icd10-catalog/icd10-catalog.module';

import { DoctorEncounterAccessService } from './common/doctor-encounter-access.service';
import { CaseOverviewController } from './case-overview/case-overview.controller';
import { CaseOverviewService } from './case-overview/case-overview.service';

import { ClinicalExaminationController } from './clinical-examination/clinical-examination.controller';
import { ClinicalExaminationService } from './clinical-examination/clinical-examination.service';

import { InitialDiagnosisController } from './initial-diagnosis/initial-diagnosis.controller';
import { InitialDiagnosisService } from './initial-diagnosis/initial-diagnosis.service';

import { ServiceLookupController } from './service-lookup/service-lookup.controller';
import { ServiceLookupService } from './service-lookup/service-lookup.service';

import { TestOrderController } from './test-order/test-order.controller';
import { TestOrderService } from './test-order/test-order.service';

/**
 * SE02 — Khám tim mạch, Chẩn đoán ban đầu và Chỉ định cận lâm sàng (phần bác sĩ, TRƯỚC cận lâm sàng).
 *
 * Luồng: xem hồ sơ (case-overview) -> phiếu khám tư thế/nhìn/sờ/gõ/nghe/nhận định (clinical-examination) ->
 * chẩn đoán ban đầu ICD-10 (initial-diagnosis) -> chọn dịch vụ (service-lookup) -> chỉ định (test-order).
 *
 * Không còn khung AI (tóm tắt EMR / phân tích ảnh / gợi ý chẩn đoán / gợi ý xét nghiệm) — AI duy nhất của
 * hệ thống là ECG anomaly detection, thuộc module lab-test (SE04).
 *
 * Không import LabTestModule / PostTestConsultationModule: liên lạc chỉ qua dữ liệu (Prisma) hoặc event
 * (ORDER_ITEM_CANCELLED_EVENT), giữ các module độc lập.
 */
@Module({
    imports: [PrismaModule, UserModule, DoctorModule, Icd10CatalogModule],
    controllers: [
        CaseOverviewController,
        ClinicalExaminationController,
        InitialDiagnosisController,
        ServiceLookupController,
        TestOrderController,
    ],
    providers: [
        DoctorEncounterAccessService,
        CaseOverviewService,
        ClinicalExaminationService,
        InitialDiagnosisService,
        ServiceLookupService,
        TestOrderService,
    ],
})
export class DoctorExaminationModule {}
