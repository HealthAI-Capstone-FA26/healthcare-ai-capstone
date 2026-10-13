import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { EncounterStatus, isValidEncounterTransition } from '../../../common/utils/encounter-status.util';

type Db = PrismaService | Prisma.TransactionClient;

/** Các trạng thái Encounter mà lab-test được phép tính lại (xem REFACTOR_PLAN mục 4). Ngoài tập này: không đụng. */
const STAGE_MANAGED_STATUSES: string[] = [
    EncounterStatus.AWAITING_DIAGNOSTICS,
    EncounterStatus.DIAGNOSTICS_IN_PROGRESS,
    EncounterStatus.AWAITING_REVIEW,
];

export interface DiagnosticProgressSnapshot {
    orderId: string;
    encounterId: string;
    orderStatus: string | null;
    encounterStatusBefore: string | null;
    encounterStatusAfter: string | null;
    /** true khi lần tính này đưa Encounter vào 'awaiting_review' (mọi cận lâm sàng đã xong) -> gửi thông báo hoàn tất. */
    encounterBecameAwaitingReview: boolean;
}

/**
 * NƠI DUY NHẤT tính trạng thái DiagnosticOrder và (phần cận lâm sàng của) Encounter từ trạng thái các
 * DiagnosticTask. Mọi thay đổi task (nhận, nộp kết quả, huỷ, báo ngoại lệ...) phải gọi hàm ở đây thay vì
 * tự set status — tránh 2 nơi tính khác nhau. Tính lại từ DỮ LIỆU (không tăng/giảm cờ) nên idempotent;
 * truyền `tx` để chạy trong cùng transaction với thay đổi task.
 *
 * Quy tắc:
 *  - Order : không còn item 'ordered' (còn task chưa huỷ) -> cancelled; mọi task completed -> completed (+completedAt);
 *            có task in_progress/completed -> in_progress; còn lại -> ordered.
 *  - Encounter (chỉ khi đang awaiting_diagnostics | diagnostics_in_progress | awaiting_review):
 *            không còn task nào -> in_progress (huỷ hết, bác sĩ chỉ định lại);
 *            mọi task completed -> awaiting_review; có task in_progress -> diagnostics_in_progress;
 *            còn lại giữ diagnostics_in_progress nếu đã có task completed, ngược lại awaiting_diagnostics.
 */
@Injectable()
export class DiagnosticProgressService {
    private readonly logger = new Logger(DiagnosticProgressService.name);

    constructor(private readonly prisma: PrismaService) {}

    async recomputeForTask(taskId: string, db: Db = this.prisma): Promise<DiagnosticProgressSnapshot | null> {
        const task = await db.diagnosticTask.findUnique({
            where: { taskId },
            select: { orderItem: { select: { orderId: true, order: { select: { encounterId: true } } } } },
        });
        if (!task) return null;

        const { orderId, order } = task.orderItem;
        const orderStatus = await this.recomputeOrderStatus(orderId, db);
        const stage = await this.recomputeEncounterStage(order.encounterId, db);

        return {
            orderId,
            encounterId: order.encounterId,
            orderStatus,
            encounterStatusBefore: stage.before,
            encounterStatusAfter: stage.after,
            encounterBecameAwaitingReview:
                stage.before !== EncounterStatus.AWAITING_REVIEW && stage.after === EncounterStatus.AWAITING_REVIEW,
        };
    }

    async recomputeOrderStatus(orderId: string, db: Db = this.prisma): Promise<string | null> {
        const order = await db.diagnosticOrder.findUnique({
            where: { orderId },
            include: { items: { include: { task: { select: { status: true } } } } },
        });
        if (!order) return null;

        // item còn hiệu lực: chưa huỷ và task (nếu có) chưa huỷ
        const active = order.items.filter((i) => i.status === 'ordered' && i.task?.status !== 'cancelled');

        let next: string;
        if (active.length === 0) {
            next = 'cancelled';
        } else if (active.every((i) => i.task?.status === 'completed')) {
            next = 'completed';
        } else if (active.some((i) => i.task && ['in_progress', 'completed'].includes(i.task.status))) {
            next = 'in_progress';
        } else {
            next = 'ordered';
        }

        const nextCompletedAt = next === 'completed' ? (order.completedAt ?? new Date()) : null;
        if (next !== order.status || (nextCompletedAt === null) !== (order.completedAt === null)) {
            await db.diagnosticOrder.update({
                where: { orderId },
                data: { status: next, completedAt: nextCompletedAt },
            });
        }
        return next;
    }

    async recomputeEncounterStage(
        encounterId: string,
        db: Db = this.prisma,
    ): Promise<{ before: string | null; after: string | null }> {
        const encounter = await db.encounter.findUnique({ where: { encounterId }, select: { status: true } });
        if (!encounter) return { before: null, after: null };

        const current = encounter.status;
        if (!STAGE_MANAGED_STATUSES.includes(current)) return { before: current, after: current };

        const orders = await db.diagnosticOrder.findMany({
            where: { encounterId, status: { not: 'cancelled' } },
            select: { items: { where: { status: 'ordered' }, select: { task: { select: { status: true } } } } },
        });
        const taskStatuses = orders
            .flatMap((o) => o.items.map((i) => i.task?.status))
            .filter((s): s is string => !!s && s !== 'cancelled');

        let target: string;
        if (taskStatuses.length === 0) {
            target = EncounterStatus.IN_PROGRESS;
        } else if (taskStatuses.every((s) => s === 'completed')) {
            target = EncounterStatus.AWAITING_REVIEW;
        } else if (taskStatuses.some((s) => s === 'in_progress')) {
            target = EncounterStatus.DIAGNOSTICS_IN_PROGRESS;
        } else if (current === EncounterStatus.DIAGNOSTICS_IN_PROGRESS && taskStatuses.some((s) => s === 'completed')) {
            target = EncounterStatus.DIAGNOSTICS_IN_PROGRESS;
        } else {
            target = EncounterStatus.AWAITING_DIAGNOSTICS;
        }

        if (target === current) return { before: current, after: current };

        if (!isValidEncounterTransition(current, target)) {
            this.logger.warn(`Bỏ qua chuyển trạng thái encounter ${encounterId}: '${current}' -> '${target}' không hợp lệ.`);
            return { before: current, after: current };
        }

        // CAS theo trạng thái hiện tại: nếu đã bị request khác đổi thì không ghi đè.
        const result = await db.encounter.updateMany({
            where: { encounterId, status: current },
            data: { status: target },
        });
        return { before: current, after: result.count > 0 ? target : current };
    }
}
