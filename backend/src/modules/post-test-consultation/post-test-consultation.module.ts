import { Module } from '@nestjs/common';
import { UserModule } from '../user/user.module';
import { DoctorModule } from '../doctor/doctor.module';
import { Icd10CatalogModule } from '../shared/icd10-catalog/icd10-catalog.module';

import { CaseTimelineController } from './case-timeline/case-timeline.controller';
import { CaseTimelineService } from './case-timeline/case-timeline.service';

import { AiDiagnosisReviewController } from './ai-diagnosis-review/ai-diagnosis-review.controller';
import { AiDiagnosisReviewService } from './ai-diagnosis-review/ai-diagnosis-review.service';

import { DiagnosisConclusionController } from './diagnosis-conclusion/diagnosis-conclusion.controller';
import { DiagnosisConclusionService } from './diagnosis-conclusion/diagnosis-conclusion.service';

import { TreatmentConsultationController } from './treatment-consultation/treatment-consultation.controller';
import { TreatmentConsultationService } from './treatment-consultation/treatment-consultation.service';

/**
 * MODULE 8 — Chẩn đoán hậu xét nghiệm & Tư vấn (giai đoạn SAU khi có kết quả xét nghiệm).
 *
 * Gồm 3 nhóm nghiệp vụ (đúng như comment đã chừa sẵn ở DoctorExaminationModule — Module 5, và
 * Icd10CatalogService — module dùng chung):
 *  1. Tổng hợp tiến trình bệnh án -> case-timeline (đọc tổng hợp, thuần read-model).
 *  2. Đề xuất chẩn đoán từ AI -> ai-diagnosis-review (khung chờ tích hợp, sourceType =
 *     'comprehensive_review', KHÔNG dùng chung provider/interface với Module 5 dù ghi chung bảng
 *     AiDiagnosisSuggestion — provider thật (AI_DIAGNOSIS_REVIEW_PROVIDER) CHƯA được bind ở đây).
 *  3. Kết luận chuyên môn + Tư vấn điều trị -> diagnosis-conclusion (bác sĩ Chấp nhận/Phủ quyết AI,
 *     tạo Diagnosis.diagnosisType='final', chuẩn hoá ICD-10 qua Icd10CatalogModule dùng chung) và
 *     treatment-consultation (ghi TreatmentConsultation, tự đóng Encounter -> 'finished').
 *
 * Không import ngược DoctorExaminationModule (Module 5) hay LabTestModule (Module 7); liên lạc
 * với các module đó chỉ qua dữ liệu (Prisma, đọc chung DB) — giữ đúng yêu cầu module-based,
 * không đè lẫn nhau. Icd10CatalogModule là module DÙNG CHUNG độc lập, được cả 2 bên import.
 */
@Module({
    imports: [UserModule, DoctorModule, Icd10CatalogModule],
    controllers: [
        CaseTimelineController,
        AiDiagnosisReviewController,
        DiagnosisConclusionController,
        TreatmentConsultationController,
    ],
    providers: [
        CaseTimelineService,
        AiDiagnosisReviewService,
        DiagnosisConclusionService,
        TreatmentConsultationService,
    ],
    exports: [AiDiagnosisReviewService, DiagnosisConclusionService],
})
export class PostTestConsultationModule {}
