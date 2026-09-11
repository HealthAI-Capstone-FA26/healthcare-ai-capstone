import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AiClinicalSummaryService } from '../ai-clinical-summary/ai-clinical-summary.service';
import { AiImagingAnalysisService } from '../ai-imaging-analysis/ai-imaging-analysis.service';
import { InitialDiagnosisSuggestionService } from '../ai-diagnosis-suggestion/initial-diagnosis-suggestion.service';

/**
 * Tổng hợp toàn bộ dữ liệu bác sĩ cần xem trước khi khám (Module 5, mục "Xem thông tin & Đánh giá
 * từ AI"): thông tin cá nhân, tiền sử bệnh/dị ứng, sinh hiệu, triệu chứng khai báo, bản tóm tắt AI
 * (kèm nguồn tham chiếu), lịch sử hình ảnh y khoa đã được AI phân tích (khoanh vùng bất thường),
 * và chẩn đoán sơ bộ do AI đề xuất (kèm confidence score).
 *
 * Đây là 1 read-model tổng hợp thuần tuý (chỉ đọc, ghép dữ liệu từ nhiều bảng thuộc nhiều
 * domain/module khác nhau qua Prisma trực tiếp) — không chứa nghiệp vụ ghi, và không phụ thuộc
 * ngược vào các module khác (reception-intake, vitals...) để giữ doctor-examination độc lập.
 */
@Injectable()
export class CaseOverviewService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly aiClinicalSummaryService: AiClinicalSummaryService,
        private readonly aiImagingAnalysisService: AiImagingAnalysisService,
        private readonly initialDiagnosisSuggestionService: InitialDiagnosisSuggestionService,
    ) {}

    async getOverview(encounterId: string) {
        const encounter = await this.prisma.encounter.findUnique({
            where: { encounterId },
            include: {
                patient: true,
                department: true,
                doctor: true,
                chiefComplaint: true,
                clinicalExamination: true,
            },
        });

        if (!encounter) {
            throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
        }

        const patientId = encounter.patientId;

        const [latestVitalSession, allergies, medicalHistories, aiClinicalSummary, imagingHistory, aiDiagnosisSuggestions] =
            await Promise.all([
                this.prisma.vitalSignSession.findFirst({
                    where: { encounterId },
                    orderBy: { measuredAt: 'desc' },
                    include: { observations: { include: { item: true } } },
                }),
                this.prisma.patientAllergy.findMany({
                    where: { patientId, status: 'active' },
                    orderBy: { recordedAt: 'desc' },
                }),
                this.prisma.patientMedicalHistory.findMany({
                    where: { patientId, status: 'active' },
                    orderBy: { recordedAt: 'desc' },
                }),
                this.aiClinicalSummaryService.getByEncounterId(encounterId),
                this.aiImagingAnalysisService.listImagingHistoryByPatient(patientId),
                this.initialDiagnosisSuggestionService.listByEncounterId(encounterId),
            ]);

        return {
            encounter: {
                encounterId: encounter.encounterId,
                status: encounter.status,
                arrivedAt: encounter.arrivedAt,
                department: encounter.department,
                doctor: encounter.doctor,
            },
            patient: encounter.patient,
            chiefComplaint: encounter.chiefComplaint,
            clinicalExamination: encounter.clinicalExamination,
            latestVitalSession,
            allergies,
            medicalHistories,
            aiClinicalSummary,
            imagingHistory,
            aiDiagnosisSuggestions,
        };
    }
}
