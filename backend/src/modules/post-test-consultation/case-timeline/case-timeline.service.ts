import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { getEncounterLabResults } from '../shared/encounter-lab-results.util';

export type TimelineEventType =
    | 'chief_complaint'
    | 'vital_sign_session'
    | 'clinical_examination'
    | 'test_order'
    | 'lab_result'
    | 'diagnosis'
    | 'treatment_consultation';

export interface TimelineEvent {
    type: TimelineEventType;
    occurredAt: Date;
    summary: string;
    data: unknown;
}

/**
 * Module 8, mục "Tổng hợp tiến trình bệnh án": tự động truy xuất & hiển thị dữ liệu y tế của
 * bệnh nhân theo trình tự thời gian (timeline) cho 1 lượt khám (encounter) — sinh hiệu, tiền
 * sử/dị ứng, kết quả thăm khám lâm sàng (Module 5) và các kết quả xét nghiệm vừa thực hiện
 * (Module 7), để bác sĩ có đủ ngữ cảnh trước khi kết luận chẩn đoán chính thức.
 *
 * Cùng triết lý với CaseOverviewService (Module 5, case-overview): read-model tổng hợp thuần tuý,
 * chỉ đọc/ghép dữ liệu qua Prisma trực tiếp, KHÔNG chứa nghiệp vụ ghi và KHÔNG import ngược
 * DoctorExaminationModule (Module 5) hay LabTestModule (Module 7) — chỉ đọc chung 1 database theo
 * đúng ranh giới "module-based, không đè lẫn nhau, liên lạc qua dữ liệu".
 *
 * Khác biệt so với case-overview: case-overview phục vụ bác sĩ TRƯỚC xét nghiệm (chưa có kết quả
 * lab, cần đọc summary/AI sơ bộ); case-timeline phục vụ bác sĩ SAU xét nghiệm — trọng tâm là dựng
 * lại đúng TRÌNH TỰ THỜI GIAN các sự kiện lâm sàng, có thêm khối kết quả xét nghiệm mà lúc khám
 * ban đầu chưa tồn tại.
 */
@Injectable()
export class CaseTimelineService {
    constructor(private readonly prisma: PrismaService) { }

    async getTimeline(encounterId: string) {
        const encounter = await this.prisma.encounter.findUnique({
            where: { encounterId },
            include: {
                patient: true,
                department: true,
                doctor: true,
                chiefComplaint: true,
                clinicalExamination: { include: { doctor: true } },
                treatmentConsultation: true,
            },
        });

        if (!encounter) {
            throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
        }

        const patientId = encounter.patientId;

        const [vitalSessions, allergies, medicalHistories, diagnoses, labResultRows, testOrders] =
            await Promise.all([
                this.prisma.vitalSignSession.findMany({
                    where: { encounterId },
                    orderBy: { measuredAt: 'asc' },
                    include: { observations: { include: { item: true } } },
                }),
                // Dị ứng/tiền sử là hồ sơ DÀI HẠN theo patientId (không gắn cứng 1 encounter — xem
                // comment PatientAllergy/PatientMedicalHistory trong schema.prisma), nên hiển thị
                // toàn bộ hồ sơ đang active, không chỉ phần khai báo trong lượt khám này.
                this.prisma.patientAllergy.findMany({
                    where: { patientId, status: 'active' },
                    orderBy: { recordedAt: 'desc' },
                }),
                this.prisma.patientMedicalHistory.findMany({
                    where: { patientId, status: 'active' },
                    orderBy: { recordedAt: 'desc' },
                }),
                this.prisma.diagnosis.findMany({
                    where: { encounterId },
                    orderBy: { diagnosedAt: 'asc' },
                    include: { icd10: true, aiSuggestion: true },
                }),
                getEncounterLabResults(this.prisma, encounterId),
                this.prisma.testOrder.findMany({
                    where: { encounterId },
                    orderBy: { orderedAt: 'asc' },
                    include: { items: { include: { testType: true } } },
                }),
            ]);

        const events: TimelineEvent[] = [];

        if (encounter.chiefComplaint) {
            events.push({
                type: 'chief_complaint',
                occurredAt: encounter.chiefComplaint.createdAt,
                summary: 'Lý do khám / triệu chứng khai báo',
                data: encounter.chiefComplaint,
            });
        }

        for (const session of vitalSessions) {
            events.push({
                type: 'vital_sign_session',
                occurredAt: session.measuredAt,
                summary: `Đo sinh hiệu (${session.observations.length} chỉ số)`,
                data: session,
            });
        }

        if (encounter.clinicalExamination) {
            events.push({
                type: 'clinical_examination',
                occurredAt: encounter.clinicalExamination.examinedAt,
                summary: 'Khám lâm sàng',
                data: encounter.clinicalExamination,
            });
        }

        for (const order of testOrders) {
            events.push({
                type: 'test_order',
                occurredAt: order.orderedAt,
                summary: `Chỉ định xét nghiệm: ${order.items.map((i) => i.testType.testName).join(', ')}`,
                data: order,
            });
        }

        for (const row of labResultRows) {
            events.push({
                type: 'lab_result',
                occurredAt: row.labResult.resultedAt,
                summary: `Kết quả xét nghiệm '${row.testName}' (${row.labResult.resultStatus})`,
                data: row,
            });
        }

        for (const diagnosis of diagnoses) {
            events.push({
                type: 'diagnosis',
                occurredAt: diagnosis.diagnosedAt,
                summary: `Chẩn đoán ${diagnosis.diagnosisType === 'final' ? 'chính thức' : 'sơ bộ'}: ${diagnosis.diagnosisName} (${diagnosis.icd10Code})`,
                data: diagnosis,
            });
        }

        if (encounter.treatmentConsultation) {
            events.push({
                type: 'treatment_consultation',
                occurredAt: encounter.treatmentConsultation.consultedAt,
                summary: 'Tư vấn điều trị',
                data: encounter.treatmentConsultation,
            });
        }

        events.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

        return {
            encounter: {
                encounterId: encounter.encounterId,
                encounterCode: encounter.encounterCode,
                status: encounter.status,
                arrivedAt: encounter.arrivedAt,
                department: encounter.department,
                doctor: encounter.doctor,
            },
            patient: encounter.patient,
            // Hồ sơ dài hạn — hiển thị riêng, không nằm trong dòng thời gian vì không gắn 1 mốc
            // thời gian thuộc lượt khám này.
            allergies,
            medicalHistories,
            // Dòng thời gian đã gộp & sắp xếp theo occurredAt tăng dần.
            timeline: events,
        };
    }
}