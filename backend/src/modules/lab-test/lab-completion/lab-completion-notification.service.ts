import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Báo hoàn tất: sau khi TẤT CẢ các phòng xét nghiệm liên quan đến 1 lượt chỉ định đã có
 * kết quả cuối cùng (resultStatus 'final' hoặc 'corrected' — không tính 'preliminary'),
 * gửi Notification cho bác sĩ phụ trách và bệnh nhân.
 *
 * ⚠️ CẦN ĐIỀU CHỈNH: cũng như LabPatientContextResolver, việc "nhóm các LabTask nào cùng
 * thuộc 1 lượt chỉ định của 1 lượt khám" phụ thuộc vào quan hệ TestOrderItem -> TestOrder ->
 * Encounter (không có trong schema.prisma được cung cấp cho module này). Cách triển khai dưới
 * đây nhóm theo `encounterId` (giả định lấy được qua orderItem, xem TODO) — tức "hoàn tất" nghĩa là
 * mọi LabTask của lượt khám đó đều đã completed + có LabResult final/corrected. Nếu hệ thống có
 * khái niệm "1 lượt chỉ định" hẹp hơn 1 encounter (VD: nhiều đợt chỉ định trong cùng 1 lượt khám),
 * đổi điều kiện group-by bên dưới sang `testOrderId` cho đúng.
 */
@Injectable()
export class LabCompletionNotificationService {
    private readonly logger = new Logger(LabCompletionNotificationService.name);

    constructor(private readonly prisma: PrismaService) {}

    async checkAndNotifyIfComplete(labResultId: string): Promise<void> {
        const labResult = await this.prisma.labResult.findUnique({
            where: { labResultId },
            include: { labTask: { include: { orderItem: true } } },
        });
        if (!labResult) return;

        // Chỉ coi là "có kết quả" khi đã final/corrected — preliminary chưa tính là hoàn tất.
        if (labResult.resultStatus !== 'final' && labResult.resultStatus !== 'corrected') {
            return;
        }

        const orderItem = labResult.labTask.orderItem as unknown as Record<string, unknown>;
        const encounterId = orderItem?.encounterId as string | undefined;
        if (!encounterId) {
            this.logger.warn(
                `Không xác định được encounterId cho lab result ${labResultId} — bỏ qua kiểm tra hoàn tất. ` +
                    'Cần điều chỉnh LabCompletionNotificationService theo schema TestOrderItem thật.',
            );
            return;
        }

        // Lấy toàn bộ LabTask thuộc cùng lượt khám (qua orderItem) để kiểm tra đã hoàn tất hết chưa.
        // TODO: nếu Prisma không cho filter trực tiếp theo field lồng trong quan hệ 'any', thay bằng
        // 1 truy vấn 2 bước (lấy danh sách orderItemId theo encounterId trước) cho khớp schema thật.
        const siblingTasks = await this.prisma.labTask.findMany({
            where: { orderItem: { is: { encounterId } as any } },
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
        // TODO: thay bằng truy vấn thật tới Encounter để lấy doctorUserId + patientId,
        // ví dụ:
        // const encounter = await this.prisma.encounter.findUniqueOrThrow({
        //     where: { encounterId },
        //     select: { doctorUserId: true, patientId: true },
        // });
        const encounter = await (this.prisma as unknown as {
            encounter?: { findUnique: (args: unknown) => Promise<{ doctorUserId?: string; patientId?: string } | null> };
        }).encounter?.findUnique({
            where: { encounterId },
            select: { doctorUserId: true, patientId: true },
        });

        if (!encounter) {
            this.logger.warn(
                `Không tra được thông tin lượt khám ${encounterId} để gửi thông báo hoàn tất xét nghiệm. ` +
                    'Cần điều chỉnh LabCompletionNotificationService theo model Encounter thật.',
            );
            return;
        }

        const title = 'Đã có đầy đủ kết quả xét nghiệm';
        const content = `Lượt khám ${encounterId} đã có đầy đủ kết quả từ ${totalTests} chỉ định xét nghiệm.`;

        const notifications: Array<Promise<unknown>> = [];

        if (encounter.doctorUserId) {
            notifications.push(
                this.prisma.notification.create({
                    data: {
                        recipientUserId: encounter.doctorUserId,
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
