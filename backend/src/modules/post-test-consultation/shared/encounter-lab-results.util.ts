import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Helper DÙNG CHUNG NỘI BỘ trong Module 8 (post-test-consultation) — không export ra ngoài module.
 *
 * LabResult không có cột encounterId trực tiếp (xem prisma/schema.prisma): muốn biết "các kết quả
 * xét nghiệm của 1 lượt khám" phải đi qua chuỗi quan hệ
 *   Encounter -> TestOrder -> TestOrderItem -> LabTask -> LabResult
 * (đúng theo chiều bàn giao đã thiết lập ở Module 5/7: TestOrderService.create() và LabTestModule).
 *
 * 3 chỗ trong module này đều cần lại chuỗi truy vấn giống nhau (case-timeline để hiển thị, ai-
 * diagnosis-review để làm input cho AI, diagnosis-conclusion để chặn kết luận khi chưa có kết quả) —
 * nên gom về đây thay vì mỗi service tự viết lại include lồng nhau. Không dùng type thủ công phức
 * tạp — để TypeScript tự suy luận shape trả về từ Prisma include, tránh lệch type khi schema đổi.
 */

const TERMINAL_LAB_RESULT_STATUSES = ['final', 'corrected'];

/** Danh sách TẤT CẢ hạng mục xét nghiệm đã có kết quả (đã nhập, bất kể preliminary/final) của 1 encounter. */
export async function getEncounterLabResults(prisma: PrismaService, encounterId: string) {
    const testOrders = await prisma.testOrder.findMany({
        where: { encounterId },
        orderBy: { orderedAt: 'asc' },
        include: {
            items: {
                include: {
                    testType: true,
                    labTask: {
                        include: {
                            labResult: {
                                include: {
                                    values: { include: { parameter: true } },
                                    attachments: true,
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
        testTypeId: string;
        testName: string;
        category: string;
        orderedAt: Date;
        labTaskStatus: string;
        // NonNullable lồng 2 lớp: lớp ngoài gỡ null của labTask (đã include, chỉ null nếu LabTask
        // Optional trên TestOrderItem), lớp trong gỡ null của chính labResult (quan hệ 1-1
        // Optional trên LabTask) — vì tại thời điểm push (dòng dưới) đã guard
        // `if (item.labTask?.labResult)` nên chắc chắn khác null, chỉ là kiểu suy luận mặc định
        // của Prisma vẫn giữ '| null' cho field này nếu không strip tường minh.
        labResult: NonNullable<NonNullable<(typeof testOrders)[number]['items'][number]['labTask']>['labResult']>;
    }> = [];

    for (const order of testOrders) {
        for (const item of order.items) {
            if (item.labTask?.labResult) {
                rows.push({
                    orderItemId: item.orderItemId,
                    testTypeId: item.testTypeId,
                    testName: item.testType.testName,
                    category: item.testType.category,
                    orderedAt: order.orderedAt,
                    labTaskStatus: item.labTask.status,
                    labResult: item.labTask.labResult,
                });
            }
        }
    }
    return rows;
}

export type EncounterLabResultRow = Awaited<ReturnType<typeof getEncounterLabResults>>[number];

/** true nếu có ÍT NHẤT 1 kết quả xét nghiệm đã chốt (final|corrected) */
export function hasFinalizedLabResult(rows: EncounterLabResultRow[]): boolean {
    return rows.some((r) => r.labResult != null && TERMINAL_LAB_RESULT_STATUSES.includes(r.labResult.resultStatus));
}