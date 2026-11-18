import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { EncounterStatus } from '../../../../common/utils/encounter-status.util';
import { DOCTOR_PUBLIC_SELECT, DOCTOR_WRITABLE_STATUSES, ORDERABLE_STATUSES } from '../common/encounter-status.guard';

/**
 * SE02 — Tổng hợp dữ liệu bác sĩ cần xem trước/trong lúc khám: thông tin cá nhân, lý do khám, sinh hiệu
 * mới nhất (kèm cảnh báo bất thường đang active), dị ứng, tiền sử, kết quả khám lâm sàng, chẩn đoán ban đầu
 * và các chỉ định cận lâm sàng (kèm tiến độ từng task).
 *
 * Read-model thuần tuý (chỉ đọc, ghép dữ liệu qua Prisma) — không chứa nghiệp vụ ghi và không phụ thuộc ngược
 * vào module khác. Không còn tóm tắt/gợi ý chẩn đoán/hình ảnh do AI (đã gỡ khỏi phạm vi).
 */
@Injectable()
export class CaseOverviewService {
    constructor(private readonly prisma: PrismaService) { }

    async getOverview(encounterId: string) {
        const encounter = await this.prisma.encounter.findUnique({
            where: { encounterId },
            include: {
                patient: true,
                doctor: { select: DOCTOR_PUBLIC_SELECT },
                chiefComplaint: true,
                clinicalExamination: { include: { doctor: { select: DOCTOR_PUBLIC_SELECT } } },
            },
        });

        if (!encounter) {
            throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
        }

        const patientId = encounter.patientId;

        const [latestVitalSession, allergies, medicalHistories, initialDiagnoses, diagnosticOrders] = await Promise.all([
            this.prisma.vitalSignSession.findFirst({
                where: { encounterId },
                orderBy: { measuredAt: 'desc' },
                include: {
                    observations: {
                        include: { item: true, vitalSignAlerts: { where: { status: 'active' } } },
                    },
                },
            }),
            this.prisma.patientAllergy.findMany({
                where: { patientId, status: 'active' },
                orderBy: { recordedAt: 'desc' },
            }),
            this.prisma.patientMedicalHistory.findMany({
                where: { patientId, status: 'active' },
                orderBy: { recordedAt: 'desc' },
            }),
            this.prisma.diagnosis.findMany({
                where: { encounterId, diagnosisType: { in: ['initial', 'differential'] } },
                orderBy: { diagnosedAt: 'desc' },
                include: { icd10: true },
            }),
            this.prisma.diagnosticOrder.findMany({
                where: { encounterId },
                orderBy: { orderedAt: 'desc' },
                include: { items: { include: { service: true, task: { select: { taskId: true, status: true } } } } },
            }),
        ]);

        return {
            encounter: {
                encounterId: encounter.encounterId,
                encounterCode: encounter.encounterCode,
                status: encounter.status,
                arrivedAt: encounter.arrivedAt,
                doctor: encounter.doctor,
            },
            patient: encounter.patient,
            chiefComplaint: encounter.chiefComplaint,
            latestVitalSession,
            allergies,
            medicalHistories,
            clinicalExamination: encounter.clinicalExamination,
            initialDiagnoses,
            diagnosticOrders,
            workflow: this.buildWorkflow(encounter.status, Boolean(encounter.clinicalExamination), initialDiagnoses, diagnosticOrders),
        };
    }

    /**
     * Cờ cho frontend dựng phiếu khám: bước nào đang mở, đã đủ điều kiện chỉ định chưa.
     * Quy trình: bắt đầu khám -> phiếu thăm khám -> chẩn đoán ban đầu (ICD-10) -> chỉ định cận lâm sàng.
     */
    private buildWorkflow(
        status: string,
        hasExamination: boolean,
        diagnoses: { diagnosisType: string }[],
        orders: { status: string }[],
    ) {
        const hasInitialDiagnosis = diagnoses.some((d) => d.diagnosisType === 'initial');
        const canWrite = DOCTOR_WRITABLE_STATUSES.includes(status);
        const canOrder = ORDERABLE_STATUSES.includes(status) && hasInitialDiagnosis;

        let nextStep: string;
        if (status === EncounterStatus.WAITING_FOR_DOCTOR) nextStep = 'start_examination';
        else if (!canWrite) nextStep = 'none';
        else if (!hasExamination) nextStep = 'record_clinical_examination';
        else if (!hasInitialDiagnosis) nextStep = 'record_initial_diagnosis';
        else if (!orders.some((o) => o.status !== 'cancelled')) nextStep = 'order_tests';
        else nextStep = 'await_results';

        return {
            encounterStatus: status,
            canRecordExamination: canWrite,
            hasClinicalExamination: hasExamination,
            hasInitialDiagnosis,
            canOrderTests: canOrder,
            nextStep,
        };
    }
}
