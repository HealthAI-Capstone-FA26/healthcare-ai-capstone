import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { DoctorModule } from '../doctor/doctor.module';
import { Icd10CatalogModule } from '../shared/icd10-catalog/icd10-catalog.module';

import { CaseOverviewController } from './case-overview/case-overview.controller';
import { CaseOverviewService } from './case-overview/case-overview.service';

import { ClinicalExaminationController } from './clinical-examination/clinical-examination.controller';
import { ClinicalExaminationService } from './clinical-examination/clinical-examination.service';
import { PreliminaryDiagnosisController } from './clinical-examination/preliminary-diagnosis.controller';
import { PreliminaryDiagnosisService } from './clinical-examination/preliminary-diagnosis.service';

import { TestRecommendationController } from './test-recommendation/test-recommendation.controller';
import { TestRecommendationService } from './test-recommendation/test-recommendation.service';

import { TestOrderController } from './test-order/test-order.controller';
import { TestOrderService } from './test-order/test-order.service';

import { AiClinicalSummaryController } from './ai-clinical-summary/ai-clinical-summary.controller';
import { AiClinicalSummaryService } from './ai-clinical-summary/ai-clinical-summary.service';

import { AiImagingAnalysisController } from './ai-imaging-analysis/ai-imaging-analysis.controller';
import { AiImagingAnalysisService } from './ai-imaging-analysis/ai-imaging-analysis.service';

import { InitialDiagnosisSuggestionController } from './ai-diagnosis-suggestion/initial-diagnosis-suggestion.controller';
import { InitialDiagnosisSuggestionService } from './ai-diagnosis-suggestion/initial-diagnosis-suggestion.service';

/**
 * MODULE 5 — Khám, Chẩn đoán sơ bộ và Chỉ định xét nghiệm (giai đoạn TRƯỚC xét nghiệm).
 *
 * Gồm 3 nhóm nghiệp vụ:
 *  1. Xem thông tin & Đánh giá từ AI  -> case-overview (đọc tổng hợp) + 3 khung AI
 *     (ai-clinical-summary, ai-imaging-analysis, ai-diagnosis-suggestion) — các khung AI hiện là
 *     no-op an toàn, chờ bind provider thật (AI_CLINICAL_SUMMARY_PROVIDER,
 *     AI_IMAGING_ANALYSIS_PROVIDER, INITIAL_DIAGNOSIS_SUGGESTION_PROVIDER).
 *  2. Ghi nhận chẩn đoán -> clinical-examination (khám lâm sàng + chẩn đoán sơ bộ).
 *  3. Gợi ý chỉ định -> test-recommendation (rule-based, đọc DiagnosisTestRecommendation) và
 *     test-order (bác sĩ chốt chỉ định — bridge sang module lab-test qua LabTask/event, xem
 *     test-order.service.ts).
 *
 * Không import ngược PostTestConsultationModule (Module 8) hay LabTestModule (Module 7); liên lạc
 * với các module đó chỉ qua dữ liệu (Prisma) hoặc event contract (EventEmitter2), giữ đúng yêu cầu
 * module-based, không đè lẫn nhau.
 */
@Module({
    imports: [UserModule, DoctorModule, Icd10CatalogModule],
    controllers: [
        CaseOverviewController,
        ClinicalExaminationController,
        PreliminaryDiagnosisController,
        TestRecommendationController,
        TestOrderController,
        AiClinicalSummaryController,
        AiImagingAnalysisController,
        InitialDiagnosisSuggestionController,
    ],
    providers: [
        CaseOverviewService,
        ClinicalExaminationService,
        PreliminaryDiagnosisService,
        TestRecommendationService,
        TestOrderService,
        AiClinicalSummaryService,
        AiImagingAnalysisService,
        InitialDiagnosisSuggestionService,
    ],
    exports: [AiClinicalSummaryService, AiImagingAnalysisService, InitialDiagnosisSuggestionService],
})
export class DoctorExaminationModule {}
