import { Module } from '@nestjs/common';
import { installBigIntJsonSerializer } from '../../../common/utils/bigint-json.util';
import { UserModule } from '../../identity-access/user/user.module';
import { DoctorModule } from '../../identity-access/doctor/doctor.module';
import { Icd10CatalogModule } from '../icd10-catalog/icd10-catalog.module';

import { CaseTimelineController } from './case-timeline/case-timeline.controller';
import { CaseTimelineService } from './case-timeline/case-timeline.service';

import { DiagnosisConclusionController } from './diagnosis-conclusion/diagnosis-conclusion.controller';
import { DiagnosisConclusionService } from './diagnosis-conclusion/diagnosis-conclusion.service';

import { TreatmentConsultationController } from './treatment-consultation/treatment-consultation.controller';
import { TreatmentConsultationService } from './treatment-consultation/treatment-consultation.service';

// Timeline trả DiagnosticResultAttachment.sizeBytes / EcgRecording.signalSizeBytes (BigInt) — cài serializer JSON (idempotent).
installBigIntJsonSerializer();

/**
 * SE05 — Chẩn đoán hậu cận lâm sàng & Tư vấn điều trị (giai đoạn SAU khi mọi cận lâm sàng đã có kết quả).
 *
 * Gồm 3 nhóm nghiệp vụ:
 *  1. Tổng hợp tiến trình bệnh án -> case-timeline (read-model thuần tuý: kết quả cận lâm sàng, ECG + AI, cảnh báo mở).
 *  2. Kết luận chuyên môn -> diagnosis-conclusion (bác sĩ TỰ kết luận, tạo Diagnosis.diagnosisType='final', chuẩn hoá
 *     ICD-10 qua Icd10CatalogModule dùng chung).
 *  3. Tư vấn điều trị -> treatment-consultation (ghi TreatmentConsultation; tái khám chỉ lưu gợi ý số ngày).
 *
 * Không còn AI gợi ý/phản biện chẩn đoán (đã gỡ khỏi phạm vi). CỔNG GHI: chỉ khi Encounter = 'awaiting_review' (do
 * lab-test đặt khi mọi cận lâm sàng xong). Module KHÔNG đổi trạng thái Encounter — việc kê đơn, hẹn tái khám và đóng
 * lượt khám ('finished') thuộc SE06.
 *
 * Không import ngược DoctorExaminationModule (SE02) hay LabTestModule (SE04): liên lạc chỉ qua dữ liệu (Prisma).
 * Không export provider nào (không module nào import service của module này).
 */
@Module({
    imports: [UserModule, DoctorModule, Icd10CatalogModule],
    controllers: [CaseTimelineController, DiagnosisConclusionController, TreatmentConsultationController],
    providers: [CaseTimelineService, DiagnosisConclusionService, TreatmentConsultationService],
})
export class PostTestConsultationModule { }
