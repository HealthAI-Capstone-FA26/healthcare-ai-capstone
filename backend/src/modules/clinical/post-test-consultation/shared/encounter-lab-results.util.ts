import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { EncounterStatus } from '../../../../common/utils/encounter-status.util';

/**
 * Helper DÙNG CHUNG NỘI BỘ trong SE05 (post-test-consultation) — không export ra ngoài module.
 *
 * (1) assertEncounterAwaitingReview — CỔNG GHI của SE05: chỉ cho kết luận chẩn đoán / tư vấn điều trị khi
 *     Encounter.status = 'awaiting_review'. Trạng thái này do lab-test (SE04) đặt khi MỌI chỉ định cận lâm sàng
 *     không-bị-huỷ đã hoàn tất — SE05 chỉ ĐỌC, không tự suy luận lại từ dữ liệu (một nguồn sự thật duy nhất).
 *     Nếu bác sĩ chỉ định thêm sau khi xem kết quả, SE02 đẩy encounter về 'awaiting_diagnostics' => cổng tự khoá
 *     cho tới khi lab-test báo xong lần nữa.
 *
 * (2) getEncounterDiagnosticResults / getEncounterEcgRecordings — đọc tổng hợp kết quả cận lâm sàng. Chuỗi quan hệ:
 *       Encounter -> DiagnosticOrder -> DiagnosticOrderItem -> DiagnosticTask -> DiagnosticResult (+ values, alerts, tệp)
 *     ECG đọc riêng theo EcgRecording.encounterId (có cột trực tiếp) kèm phân tích AI hiện hành.
 *     Không dùng type thủ công: để TypeScript suy luận từ Prisma include để không lệch khi schema đổi.
 */

const SAFE_USER_SELECT = { userId: true, email: true, profile: { select: { fullName: true } } } as const;

/** Giải thích vì sao chưa kết luận được, theo trạng thái hiện tại của lượt khám. */
function explainNotReady(status: string): string {
    switch (status) {
        case EncounterStatus.CANCELLED:
        case EncounterStatus.FINISHED:
            return `Lượt khám đang ở trạng thái '${status}', không thể ghi nhận kết luận chuyên môn.`;
        case EncounterStatus.AWAITING_DIAGNOSTICS:
        case EncounterStatus.DIAGNOSTICS_IN_PROGRESS:
            return `Các chỉ định cận lâm sàng chưa hoàn tất (lượt khám đang '${status}'). Chờ phòng thực hiện nhập đủ kết quả trước khi kết luận.`;
        default:
            return (
                `Lượt khám đang ở trạng thái '${status}' — chưa có kết quả cận lâm sàng để kết luận. ` +
                "Cần chỉ định cận lâm sàng ở bước khám (doctor-examination/.../test-orders) và chờ hoàn tất ('awaiting_review')."
            );
    }
}

export async function assertEncounterAwaitingReview(prisma: PrismaService, encounterId: string) {
    const encounter = await prisma.encounter.findUnique({ where: { encounterId } });
    if (!encounter) {
        throw new NotFoundException(`Không tìm thấy lượt khám ${encounterId}`);
    }
    if (encounter.status !== EncounterStatus.AWAITING_REVIEW) {
        throw new BadRequestException(explainNotReady(encounter.status));
    }
    return encounter;
}

/** Mọi hạng mục cận lâm sàng ĐÃ CÓ kết quả (preliminary|final|corrected) của 1 encounter, theo thứ tự chỉ định. */
export async function getEncounterDiagnosticResults(prisma: PrismaService, encounterId: string) {
    const orders = await prisma.diagnosticOrder.findMany({
        where: { encounterId },
        orderBy: { orderedAt: 'asc' },
        include: {
            items: {
                include: {
                    service: true,
                    task: {
                        include: {
                            diagnosticRoom: { select: { diagnosticRoomId: true, diagnosticRoomName: true, modality: true } },
                            result: {
                                include: {
                                    values: { include: { parameter: true, alerts: true } },
                                    attachments: true,
                                    enteredByUser: { select: SAFE_USER_SELECT },
                                    reviewedByUser: { select: SAFE_USER_SELECT },
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    const rows: Array<{
        orderItemId: string;
        orderId: string;
        serviceId: string;
        serviceName: string;
        modality: string;
        panelGroup: string | null;
        resultKind: string;
        orderedAt: Date;
        priority: string;
        taskStatus: string;
        // Đã guard `item.task?.result` trước khi push nên chắc chắn khác null; strip tường minh vì Prisma giữ '| null'.
        result: NonNullable<NonNullable<(typeof orders)[number]['items'][number]['task']>['result']>;
    }> = [];

    for (const order of orders) {
        for (const item of order.items) {
            if (item.status === 'ordered' && item.task?.result && item.task.result.resultStatus !== 'cancelled') {
                rows.push({
                    orderItemId: item.orderItemId,
                    orderId: order.orderId,
                    serviceId: item.serviceId,
                    serviceName: item.service.serviceName,
                    modality: item.service.modality,
                    panelGroup: item.service.panelGroup,
                    resultKind: item.service.resultKind,
                    orderedAt: order.orderedAt,
                    priority: order.priority,
                    taskStatus: item.task.status,
                    result: item.task.result,
                });
            }
        }
    }
    return { orders, rows };
}

export type EncounterDiagnosticResultRow = Awaited<ReturnType<typeof getEncounterDiagnosticResults>>['rows'][number];

/** Bản ghi ECG hoàn tất của encounter kèm phân tích AI HIỆN HÀNH và các đoạn bất thường. */
export async function getEncounterEcgRecordings(prisma: PrismaService, encounterId: string) {
    return prisma.ecgRecording.findMany({
        where: { encounterId, status: 'completed' },
        orderBy: { createdAt: 'asc' },
        include: {
            analyses: {
                where: { isCurrent: true },
                include: {
                    modelVersion: { select: { modelName: true, version: true } },
                    events: { orderBy: { startOffsetMs: 'asc' } },
                },
            },
        },
    });
}
