import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { EncounterStatus } from '../../../common/utils/encounter-status.util';
import { NotificationDispatcherService } from '../notification/notification-dispatcher.service';
import { NotificationChannel } from '../notification/notification-channel.interface';

/** Kênh gửi cho bác sĩ / bệnh nhân khi hoàn tất (D4: sms & zalo_oa chỉ ghi 'queued' cho worker SE07). */
const DOCTOR_CHANNELS: NotificationChannel[] = ['in_app'];
const PATIENT_CHANNELS: NotificationChannel[] = ['in_app', 'email', 'zalo_oa'];

/**
 * Báo hoàn tất cận lâm sàng cho bác sĩ phụ trách và bệnh nhân.
 *
 * ĐIỀU KIỆN gửi KHÔNG tự tính ở đây: DiagnosticProgressService đã xác định lần nộp kết quả nào đưa Encounter vào
 * 'awaiting_review' (mọi task không-cancelled đều completed) và truyền qua LabResultSubmittedEvent.notifyCompletion.
 * Service này chỉ kiểm lại trạng thái encounter (phòng thủ) rồi gửi — nên sửa/đính chính kết quả không bắn lại
 * thông báo, còn chỉ định bổ sung xong sẽ bắn thông báo mới.
 */
@Injectable()
export class LabCompletionNotificationService {
    private readonly logger = new Logger(LabCompletionNotificationService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly dispatcher: NotificationDispatcherService,
    ) {}

    async notifyForResult(resultId: string): Promise<void> {
        const result = await this.prisma.diagnosticResult.findUnique({
            where: { resultId },
            select: { task: { select: { orderItem: { select: { order: { select: { encounterId: true } } } } } } },
        });
        if (!result) return;

        await this.notifyEncounterCompleted(result.task.orderItem.order.encounterId);
    }

    async notifyEncounterCompleted(encounterId: string): Promise<void> {
        const encounter = await this.prisma.encounter.findUnique({
            where: { encounterId },
            select: {
                status: true,
                encounterCode: true,
                patient: { select: { patientId: true, email: true } },
                doctor: { select: { userId: true, user: { select: { email: true } } } },
            },
        });
        if (!encounter) return;

        if (encounter.status !== EncounterStatus.AWAITING_REVIEW) {
            this.logger.debug(`Encounter ${encounterId} đang '${encounter.status}', không phải 'awaiting_review' — bỏ qua thông báo.`);
            return;
        }

        const totalTests = await this.prisma.diagnosticTask.count({
            where: { orderItem: { status: 'ordered', order: { encounterId } }, status: { not: 'cancelled' } },
        });

        const title = 'Đã có đầy đủ kết quả cận lâm sàng';
        const content =
            `Lượt khám ${encounter.encounterCode ?? encounterId}: ${totalTests} chỉ định cận lâm sàng đã hoàn tất, ` +
            'kết quả sẵn sàng để bác sĩ xem xét.';
        const base = { notificationType: 'diagnostics_completed', referenceType: 'encounter', referenceId: encounterId, title, content };

        if (encounter.doctor?.userId) {
            await this.dispatcher.dispatch(
                { ...base, recipient: { userId: encounter.doctor.userId, email: encounter.doctor.user?.email ?? undefined } },
                DOCTOR_CHANNELS,
            );
        } else {
            this.logger.warn(`Encounter ${encounterId} chưa có bác sĩ phụ trách — không gửi thông báo cho bác sĩ.`);
        }

        await this.dispatcher.dispatch(
            { ...base, recipient: { patientId: encounter.patient.patientId, email: encounter.patient.email ?? undefined } },
            PATIENT_CHANNELS,
        );

        this.logger.log(`Đã gửi thông báo hoàn tất cận lâm sàng cho encounter ${encounterId} (${totalTests} chỉ định).`);
    }
}
