import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { EncounterStatus } from '../../../../common/utils/encounter-status.util';
import { getEncounterDiagnosticResults, getEncounterEcgRecordings } from '../shared/encounter-lab-results.util';

export type TimelineEventType =
    | 'chief_complaint'
    | 'vital_sign_session'
    | 'clinical_examination'
    | 'diagnosis'
    | 'diagnostic_order'
    | 'diagnostic_result'
    | 'ecg_recording'
    | 'ecg_ai_analysis'
    | 'treatment_consultation';

export interface TimelineEvent {
    type: TimelineEventType;
    occurredAt: Date;
    summary: string;
    data: unknown;
}

const DIAGNOSIS_TYPE_LABEL: Record<string, string> = {
    initial: 'ban đầu',
    differential: 'phân biệt',
    final: 'chính thức',
};
const PRIORITY_LABEL: Record<string, string> = { stat: ' [CẤP CỨU]', urgent: ' [khẩn]' };
const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

/**
 * SE05, "Tổng hợp tiến trình bệnh án": dựng dòng thời gian (timeline) của 1 lượt khám cho bác sĩ TRƯỚC khi kết luận —
 * sinh hiệu (kèm cờ bất thường), khám lâm sàng, chẩn đoán, chỉ định, KẾT QUẢ cận lâm sàng (xét nghiệm máu / ECG /
 * siêu âm tim / X-quang), bản ghi ECG kèm phân tích AI, và tư vấn điều trị.
 *
 * Read-model thuần tuý (chỉ đọc qua Prisma), KHÔNG import ngược DoctorExaminationModule (SE02) hay LabTestModule
 * (SE04) — liên lạc qua dữ liệu. Khác case-overview của SE02 (phục vụ TRƯỚC cận lâm sàng): ở đây trọng tâm là kết
 * quả vừa có và các CẢNH BÁO còn mở (giá trị nguy kịch, bất thường ECG) mà bác sĩ phải xử lý khi kết luận.
 */
@Injectable()
export class CaseTimelineService {
    constructor(private readonly prisma: PrismaService) { }

    async getTimeline(encounterId: string) {
        const encounter = await this.prisma.encounter.findUnique({
            where: { encounterId },
            include: {
                patient: true,
                doctor: true,
                chiefComplaint: true,
                clinicalExamination: { include: { doctor: true } },
                treatmentConsultation: { include: { doctor: true } },
            },
        });

        if (!encounter) {
            throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
        }

        const patientId = encounter.patientId;

        const [vitalSessions, allergies, medicalHistories, diagnoses, diagnostic, ecgRecordings, openValueAlerts, openEcgEvents] =
            await Promise.all([
                this.prisma.vitalSignSession.findMany({
                    where: { encounterId },
                    orderBy: { measuredAt: 'asc' },
                    include: { observations: { include: { item: true, vitalSignAlerts: true } } },
                }),
                // Dị ứng/tiền sử là hồ sơ DÀI HẠN theo patientId (không gắn cứng 1 encounter).
                this.prisma.patientAllergy.findMany({ where: { patientId, status: 'active' }, orderBy: { recordedAt: 'desc' } }),
                this.prisma.patientMedicalHistory.findMany({ where: { patientId, status: 'active' }, orderBy: { recordedAt: 'desc' } }),
                this.prisma.diagnosis.findMany({
                    where: { encounterId },
                    orderBy: { diagnosedAt: 'asc' },
                    include: { icd10: true },
                }),
                getEncounterDiagnosticResults(this.prisma, encounterId),
                getEncounterEcgRecordings(this.prisma, encounterId),
                this.prisma.resultValueAlert.findMany({
                    where: { encounterId, status: { in: ['active', 'confirmed'] } },
                    orderBy: { createdAt: 'desc' },
                    include: { resultValue: { include: { parameter: { select: { parameterCode: true, parameterName: true, unit: true } } } } },
                }),
                this.prisma.ecgAnomalyEvent.findMany({
                    where: { analysis: { ecgRecording: { encounterId }, isCurrent: true }, alertStatus: { in: ['active', 'acknowledged'] } },
                    orderBy: { anomalyScore: 'desc' },
                    take: 100,
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
            const abnormal = session.observations.filter((o) => o.isAbnormal).length;
            events.push({
                type: 'vital_sign_session',
                occurredAt: session.measuredAt,
                summary: `Đo sinh hiệu (${session.observations.length} chỉ số${abnormal > 0 ? `, ${abnormal} bất thường` : ''})`,
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

        for (const diagnosis of diagnoses) {
            events.push({
                type: 'diagnosis',
                occurredAt: diagnosis.diagnosedAt,
                summary: `Chẩn đoán ${DIAGNOSIS_TYPE_LABEL[diagnosis.diagnosisType] ?? diagnosis.diagnosisType}: ${diagnosis.diagnosisName} (${diagnosis.icd10Code})`,
                data: diagnosis,
            });
        }

        for (const order of diagnostic.orders) {
            const names = order.items.map((i) => `${i.service.serviceName}${i.status === 'cancelled' ? ' (đã huỷ)' : ''}`).join(', ');
            events.push({
                type: 'diagnostic_order',
                occurredAt: order.orderedAt,
                summary: `Chỉ định cận lâm sàng${PRIORITY_LABEL[order.priority] ?? ''}: ${names}`,
                data: order,
            });
        }

        for (const row of diagnostic.rows) {
            const abnormal = row.result.values.filter((v) => v.isAbnormal).length;
            events.push({
                type: 'diagnostic_result',
                occurredAt: row.result.resultedAt ?? row.result.createdAt,
                summary: `Kết quả '${row.serviceName}' [${row.modality}] (${row.result.resultStatus})${abnormal > 0 ? ` — ${abnormal} chỉ số bất thường` : ''}`,
                data: row,
            });
        }

        for (const recording of ecgRecordings) {
            events.push({
                type: 'ecg_recording',
                occurredAt: recording.startedAt ?? recording.createdAt,
                summary: `Bản ghi ECG (${recording.recordingType}, ${recording.numLeads} chuyển đạo, ${recording.sampleRateHz}Hz)`,
                data: { ...recording, analyses: undefined },
            });

            const analysis = recording.analyses[0];
            if (analysis?.status === 'completed' && analysis.completedAt) {
                const top = analysis.events.reduce<string | null>(
                    (best, e) => (best === null || SEVERITY_ORDER.indexOf(e.severity) > SEVERITY_ORDER.indexOf(best) ? e.severity : best),
                    null,
                );
                events.push({
                    type: 'ecg_ai_analysis',
                    occurredAt: analysis.completedAt,
                    summary:
                        `AI ECG: ${analysis.overallResult}` +
                        (analysis.events.length > 0 ? ` — ${analysis.events.length} đoạn bất thường (cao nhất: ${top})` : ''),
                    data: analysis,
                });
            }
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

        // Tiến độ cận lâm sàng (chỉ tính hạng mục còn hiệu lực) — để giao diện biết còn chờ gì.
        const activeTasks = diagnostic.orders.flatMap((o) => o.items.filter((i) => i.status === 'ordered' && i.task && i.task.status !== 'cancelled').map((i) => i.task!));
        const diagnosticProgress = {
            total: activeTasks.length,
            completed: activeTasks.filter((t) => t.status === 'completed').length,
            pending: activeTasks.filter((t) => t.status !== 'completed').length,
            cancelledItems: diagnostic.orders.reduce((n, o) => n + o.items.filter((i) => i.status === 'cancelled').length, 0),
        };

        return {
            encounter: {
                encounterId: encounter.encounterId,
                encounterCode: encounter.encounterCode,
                status: encounter.status,
                arrivedAt: encounter.arrivedAt,
                doctor: encounter.doctor,
            },
            patient: encounter.patient,
            // true khi mọi cận lâm sàng đã xong — nghĩa là bác sĩ ĐƯỢC PHÉP kết luận / tư vấn (xem cổng ghi SE05).
            readyForConclusion: encounter.status === EncounterStatus.AWAITING_REVIEW,
            diagnosticProgress,
            // Cảnh báo còn mở cần bác sĩ xử lý khi kết luận: chỉ số nguy hiểm (active|confirmed) và đoạn ECG bất thường.
            openAlerts: { resultValues: openValueAlerts, ecgAnomalies: openEcgEvents },
            // Hồ sơ dài hạn — hiển thị riêng, không nằm trong dòng thời gian.
            allergies,
            medicalHistories,
            // Dòng thời gian đã gộp & sắp xếp theo occurredAt tăng dần.
            timeline: events,
        };
    }
}
