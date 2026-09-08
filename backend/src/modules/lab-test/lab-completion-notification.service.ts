import { Injectable, Logger } from '@nestjs/common';
import { NotificationDispatcherService } from './notification/notification-dispatcher.service';
import { NotificationRecipient } from './notification/notification-channel.interface';
import { PrismaService } from 'prisma/prisma.service';

/**
 * Báo hoàn tất: sau khi TẤT CẢ các phòng xét nghiệm liên quan đến 1 lượt chỉ định đã có
 * kết quả cuối cùng (resultStatus 'final' hoặc 'corrected' — không tính 'preliminary'),
 * gửi Notification cho bác sĩ phụ trách và bệnh nhân.
 *
 * "1 lượt chỉ định" được nhóm theo `encounterId` — tức "hoàn tất" nghĩa là mọi LabTask của
 * lượt khám đó (qua LabTask -> TestOrderItem -> TestOrder -> Encounter) đều đã completed và
 * có LabResult final/corrected.
 *
 * Việc gửi thực tế được uỷ quyền cho NotificationDispatcherService (Strategy pattern) — gửi
 * qua email + in-app (ưu tiên cao) và push (ưu tiên thấp hơn, hiện là stub). Đã bỏ kênh
 * 'zalo_oa' cũ theo yêu cầu nghiệp vụ mới.
 */
@Injectable()
export class LabCompletionNotificationService {
    private readonly logger = new Logger(LabCompletionNotificationService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly notificationDispatcher: NotificationDispatcherService,
    ) { }

    async checkAndNotifyIfComplete(labResultId: string): Promise<void> {
        const labResult = await this.prisma.labResult.findUnique({
            where: { labResultId },
            include: { labTask: { include: { orderItem: { include: { order: true } } } } },
        });
        if (!labResult) return;

        // Chỉ coi là "có kết quả" khi đã final/corrected — preliminary chưa tính là hoàn tất.
        if (labResult.resultStatus !== 'final' && labResult.resultStatus !== 'corrected') {
            return;
        }

        const encounterId = labResult.labTask.orderItem.order.encounterId;

        // Lấy toàn bộ LabTask thuộc cùng lượt khám (qua orderItem -> order) để kiểm tra đã hoàn tất hết chưa.
        const siblingTasks = await this.prisma.labTask.findMany({
            where: { orderItem: { order: { encounterId } } },
            include: { labResult: true },
        });

        const allDone = siblingTasks.every(
            (t) =>
                t.status === 'completed' &&
                t.labResult &&
                (t.labResult.resultStatus === 'final' || t.labResult.resultStatus === 'corrected'),
        );

        if (!allDone) {
            this.logger.debug(`Encounter ${encounterId} chưa hoàn tất toàn bộ xét nghiệm — chưa gửi thông báo.`);
            return;
        }

        await this.notifyCompletion(encounterId, siblingTasks.length);
    }

    private async notifyCompletion(encounterId: string, totalTests: number): Promise<void> {
        const encounter = await this.prisma.encounter.findUnique({
            where: { encounterId },
            select: {
                patientId: true,
                doctor: { select: { userId: true } },
            },
        });

        if (!encounter) {
            this.logger.warn(`Không tra được thông tin lượt khám ${encounterId} để gửi thông báo hoàn tất xét nghiệm.`);
            return;
        }

        const title = 'Đã có đầy đủ kết quả xét nghiệm';
        const content = `Lượt khám ${encounterId} đã có đầy đủ kết quả từ ${totalTests} chỉ định xét nghiệm.`;

        const dispatches: Array<Promise<void>> = [];

        if (encounter.doctor?.userId) {
            const doctorUser = await this.prisma.user.findUnique({
                where: { userId: encounter.doctor.userId },
                select: { email: true },
            });
            const doctorRecipient: NotificationRecipient = {
                userId: encounter.doctor.userId,
                email: doctorUser?.email,
            };
            dispatches.push(
                this.notificationDispatcher.dispatch({
                    recipient: doctorRecipient,
                    notificationType: 'test_result_ready',
                    referenceType: 'encounter',
                    referenceId: encounterId,
                    title,
                    content,
                }),
            );
        }

        if (encounter.patientId) {
            const patientRecipient = await this.resolvePatientRecipient(encounter.patientId);
            dispatches.push(
                this.notificationDispatcher.dispatch({
                    recipient: patientRecipient,
                    notificationType: 'test_result_ready',
                    referenceType: 'encounter',
                    referenceId: encounterId,
                    title,
                    content: 'Kết quả xét nghiệm của bạn đã có đầy đủ. Vui lòng liên hệ bác sĩ hoặc xem trên ứng dụng.',
                }),
            );
        }

        await Promise.all(dispatches);
        this.logger.log(`Đã gửi thông báo hoàn tất xét nghiệm cho lượt khám ${encounterId}`);
    }

    /**
     * Resolve email/pushToken của bệnh nhân để đưa vào NotificationRecipient.
     * Theo schema.prisma: `Patient.email` (String?, VarChar 255) nằm trực tiếp trên model Patient
     * — không cần join qua User. `pushToken` hiện KHÔNG có trường lưu trữ nào trong schema (chưa
     * có bảng kiểu UserDevice/PushToken) nên luôn để trống — PushNotificationStrategy sẽ tự bỏ qua
     * (xem push-notification.strategy.ts). Khi hệ thống có bảng lưu device/push token, bổ sung
     * join tương ứng ở đây.
     */
    private async resolvePatientRecipient(patientId: string): Promise<NotificationRecipient> {
        const patient = await this.prisma.patient.findUnique({
            where: { patientId },
            select: { email: true },
        });

        return {
            patientId,
            email: patient?.email ?? undefined,
        };
    }
}
