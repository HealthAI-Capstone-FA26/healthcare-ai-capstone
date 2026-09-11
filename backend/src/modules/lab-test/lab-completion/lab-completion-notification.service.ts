import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Báo hoàn tất: sau khi TẤT CẢ các phòng xét nghiệm liên quan đến 1 lượt chỉ định đã có
 * kết quả cuối cùng (resultStatus 'final' hoặc 'corrected' — không tính 'preliminary'),
 * gửi Notification cho bác sĩ phụ trách và bệnh nhân.
 *
 * "1 lượt chỉ định" được nhóm theo `encounterId` — tức "hoàn tất" nghĩa là mọi LabTask của
 * lượt khám đó (qua LabTask -> TestOrderItem -> TestOrder -> Encounter) đều đã completed và
 * có LabResult final/corrected.
 */
@Injectable()
export class LabCompletionNotificationService {
    private readonly logger = new Logger(LabCompletionNotificationService.name);

    constructor(private readonly prisma: PrismaService) {}

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

        const doctorUserId = encounter.doctor?.userId;
        const title = 'Đã có đầy đủ kết quả xét nghiệm';
        const content = `Lượt khám ${encounterId} đã có đầy đủ kết quả từ ${totalTests} chỉ định xét nghiệm.`;

        const notifications: Array<Promise<unknown>> = [];

        if (doctorUserId) {
            notifications.push(
                this.prisma.notification.create({
                    data: {
                        recipientUserId: doctorUserId,
                        notificationType: 'test_result_ready',
                        channel: 'in_app',
                        referenceType: 'encounter',
                        referenceId: encounterId,
                        title,
                        content,
                        status: 'queued',
                    },
                }),
            );
        }

        if (encounter.patientId) {
            notifications.push(
                this.prisma.notification.create({
                    data: {
                        recipientPatientId: encounter.patientId,
                        notificationType: 'test_result_ready',
                        channel: 'zalo_oa',
                        referenceType: 'encounter',
                        referenceId: encounterId,
                        title,
                        content: 'Kết quả xét nghiệm của bạn đã có đầy đủ. Vui lòng liên hệ bác sĩ hoặc xem trên ứng dụng.',
                        status: 'queued',
                    },
                }),
            );
        }

        await Promise.all(notifications);
        this.logger.log(`Đã tạo thông báo hoàn tất xét nghiệm cho lượt khám ${encounterId}`);
    }
}
