import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Inject,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { LabRoomService } from '../lab-room-catalog/lab-room.service';
import { PAYMENT_VERIFICATION_PORT, PaymentVerificationPort } from './payment-verification.port';
import { ListLabTasksQueryDto } from './dtos/list-lab-tasks-query.dto';
import { AssignLabTaskDto } from './dtos/assign-lab-task.dto';
import { ReceiveLabTaskDto } from './dtos/receive-lab-task.dto';
import { ReportLabTaskExceptionDto } from './dtos/report-lab-task-exception.dto';
import { LAB_TASK_EXCEPTION_REPORTED_EVENT, LabTaskExceptionReportedEvent } from './events/lab-task-exception-reported.event';
import { ResolveLabTaskExceptionDto } from './dtos/resolve-lab-task-exception.dto';
import { LAB_TASK_EXCEPTION_RESOLVED_EVENT, LabTaskExceptionResolvedEvent } from './events/lab-task-exception-resolved.event';
import { DiagnosticProgressService } from './diagnostic-progress.service';
import { ActorRoleService } from '../../user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';

type Db = PrismaService | Prisma.TransactionClient;

const PRIORITY_RANK: Record<string, number> = { stat: 0, urgent: 1, routine: 2 };
const WORKLIST_FETCH_CAP = 500;

const TASK_INCLUDE = {
    diagnosticRoom: true,
    assignedStaff: { include: { profile: true } },
    orderItem: {
        include: {
            service: {
                include: {
                    resultParameters: {
                        where: { isActive: true },
                        orderBy: { displayOrder: 'asc' },
                        include: { thresholds: true },
                    },
                },
            },
            order: {
                include: {
                    doctor: true,
                    diagnosis: { include: { icd10: true } },
                    encounter: { include: { patient: true } },
                },
            },
        },
    },
    result: { include: { values: { include: { parameter: true } }, attachments: true } },
} satisfies Prisma.DiagnosticTaskInclude;

/**
 * SE04 — Tiếp nhận & vòng đời của 1 DiagnosticTask (nhiệm vụ cận lâm sàng ứng với 1 DiagnosticOrderItem):
 *   payment_pending -> ready -> in_progress -> completed
 *                            -> on_hold (phòng báo ngoại lệ, chờ bác sĩ quyết định)
 *                                            -> ready     (bác sĩ chọn 'retry')
 *                                            -> cancelled (bác sĩ chọn 'cancel' — dùng chung applyCancellationFromOrder)
 *
 * Phòng thực hiện KHÔNG có quyền chủ động huỷ chỉ định: chỉ báo cáo ngoại lệ (reportException). Huỷ chỉ xảy ra
 * theo 'order-item.cancelled' từ SE02 hoặc bác sĩ chọn 'cancel' khi task đang on_hold.
 *
 * RÀNG BUỘC THANH TOÁN: task chỉ được 'in_progress' khi paymentVerified = true (kiểm ở tầng service).
 *
 * Trạng thái DiagnosticOrder / Encounter KHÔNG được set tay ở đây — luôn gọi DiagnosticProgressService
 * (xem REFACTOR_PLAN mục 4) trong cùng transaction với thay đổi task.
 */
@Injectable()
export class LabTaskService {
    private readonly logger = new Logger(LabTaskService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly labRoomService: LabRoomService,
        @Inject(PAYMENT_VERIFICATION_PORT) private readonly paymentVerification: PaymentVerificationPort,
        private readonly eventEmitter: EventEmitter2,
        private readonly actorRoleService: ActorRoleService,
        private readonly progress: DiagnosticProgressService,
    ) {}

    /** Worklist của 1 phòng: stat > urgent > routine, rồi theo thời điểm vào hàng đợi (readyAt). */
    async listWorklist(query: ListLabTasksQueryDto) {
        const where: Prisma.DiagnosticTaskWhereInput = {
            ...(query.diagnosticRoomId ? { diagnosticRoomId: query.diagnosticRoomId } : {}),
            ...(query.status ? { status: query.status } : {}),
            ...(query.priority ? { priority: query.priority } : {}),
            ...(query.assignedStaffUserId ? { assignedStaffUserId: query.assignedStaffUserId } : {}),
            ...(query.modality ? { diagnosticRoom: { modality: query.modality } } : {}),
        };

        const tasks = await this.prisma.diagnosticTask.findMany({
            where,
            orderBy: [{ readyAt: 'asc' }, { createdAt: 'asc' }],
            take: WORKLIST_FETCH_CAP,
            include: TASK_INCLUDE,
        });

        // priority là chuỗi nên sắp ở tầng ứng dụng (sort ổn định: giữ thứ tự readyAt/createdAt trong cùng mức).
        tasks.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 99) - (PRIORITY_RANK[b.priority] ?? 99));
        return tasks.slice(0, query.limit ?? 200);
    }

    async getById(taskId: string) {
        const task = await this.prisma.diagnosticTask.findUnique({
            where: { taskId },
            include: {
                ...TASK_INCLUDE,
                result: {
                    include: {
                        values: { include: { parameter: true, alerts: true } },
                        attachments: true,
                    },
                },
                ecgRecordings: { orderBy: { createdAt: 'desc' } },
            },
        });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ cận lâm sàng ${taskId}`);
        }
        return task;
    }

    /**
     * Được module Thanh toán gọi (service-to-service, qua LabTaskPaymentNotifierAdapter) khi hoá đơn của order
     * item này được thanh toán. KHÔNG còn endpoint HTTP. Idempotent: không lùi trạng thái nếu task đã tiến xa.
     */
    async verifyPayment(taskId: string) {
        const task = await this.prisma.diagnosticTask.findUnique({ where: { taskId } });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ cận lâm sàng ${taskId}`);
        }

        const now = new Date();
        const promoted = await this.prisma.diagnosticTask.updateMany({
            where: { taskId, status: 'payment_pending' },
            data: { paymentVerified: true, paymentVerifiedAt: now, status: 'ready', readyAt: now },
        });

        if (promoted.count === 0 && !task.paymentVerified) {
            await this.prisma.diagnosticTask.update({
                where: { taskId },
                data: { paymentVerified: true, paymentVerifiedAt: now },
            });
        }

        this.logger.log(`Đã xác nhận thanh toán cho nhiệm vụ cận lâm sàng ${taskId}`);
        return this.prisma.diagnosticTask.findUniqueOrThrow({ where: { taskId } });
    }

    /**
     * Gán/đổi kỹ thuật viên phụ trách (pre-assign khi 'ready', hoặc chuyển khi 'in_progress'). KTV phải thuộc đúng
     * phòng của nhiệm vụ. Không áp dụng cho task 'completed'/'cancelled'. Người gọi phải là LAB_STAFF.
     */
    async assign(taskId: string, dto: AssignLabTaskDto, actingUserId: string) {
        await this.actorRoleService.assertActorRole(actingUserId, [ACTOR_ROLE.LAB_STAFF]);

        const task = await this.prisma.diagnosticTask.findUnique({ where: { taskId } });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ cận lâm sàng ${taskId}`);
        }
        if (task.status === 'completed' || task.status === 'cancelled') {
            throw new BadRequestException(`Không thể gán kỹ thuật viên cho nhiệm vụ đang ở trạng thái '${task.status}'.`);
        }

        const isAssigned = await this.labRoomService.isStaffAssignedToRoom(dto.assignedStaffUserId, task.diagnosticRoomId);
        if (!isAssigned) {
            throw new BadRequestException('Kỹ thuật viên này chưa được phân quyền vào phòng của nhiệm vụ.');
        }

        if (dto.assignedStaffUserId === task.assignedStaffUserId) {
            return task; // no-op
        }

        const previous = task.assignedStaffUserId;
        const updated = await this.prisma.diagnosticTask.update({
            where: { taskId },
            data: { assignedStaffUserId: dto.assignedStaffUserId },
        });

        if (previous && task.status === 'in_progress') {
            this.logger.warn(
                `REASSIGN: nhiệm vụ ${taskId} đang 'in_progress' được chuyển từ KTV ${previous} sang ${dto.assignedStaffUserId}.`,
            );
        } else {
            this.logger.log(`Gán kỹ thuật viên ${dto.assignedStaffUserId} cho nhiệm vụ ${taskId} (trước đó: ${previous ?? 'chưa gán'}).`);
        }
        return updated;
    }

    /**
     * KTV tiếp nhận để thực hiện: 'ready' -> 'in_progress'. Điểm chặn chính của ràng buộc thanh toán.
     * Chiếm task bằng updateMany có điều kiện (compare-and-swap) — 2 KTV cùng nhận, chỉ 1 thắng, người kia 409.
     * Cùng transaction: cập nhật DiagnosticOrder.status và Encounter -> diagnostics_in_progress.
     */
    async receive(taskId: string, receivingUserId: string, dto: ReceiveLabTaskDto = {}) {
        await this.actorRoleService.assertActorRole(receivingUserId, [ACTOR_ROLE.LAB_STAFF]);

        const task = await this.prisma.diagnosticTask.findUnique({
            where: { taskId },
            include: { orderItem: { include: { service: { select: { modality: true } } } } },
        });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ cận lâm sàng ${taskId}`);
        }

        if (!task.paymentVerified) {
            const paid = await this.paymentVerification.isOrderItemPaid(task.orderItemId);
            if (!paid) {
                throw new ForbiddenException(
                    'Không thể tiếp nhận: bệnh nhân chưa hoàn tất thanh toán cho chỉ định này.',
                );
            }
        }
        if (task.status === 'payment_pending') {
            // Đã thanh toán (xác nhận qua hoá đơn) nhưng webhook chưa kịp báo -> nâng lên 'ready' rồi đi tiếp.
            await this.verifyPayment(taskId);
            task.status = 'ready';
        }
        if (task.status !== 'ready') {
            throw new BadRequestException(
                `Nhiệm vụ đang ở trạng thái '${task.status}', chỉ có thể tiếp nhận khi ở trạng thái 'ready'.`,
            );
        }
        if (task.assignedStaffUserId && receivingUserId !== task.assignedStaffUserId) {
            throw new ForbiddenException('Nhiệm vụ này đã được phân công cho kỹ thuật viên khác, bạn không thể tự tiếp nhận.');
        }

        const isAssigned = await this.labRoomService.isStaffAssignedToRoom(receivingUserId, task.diagnosticRoomId);
        if (!isAssigned) {
            throw new BadRequestException('Kỹ thuật viên này chưa được phân quyền vào phòng của nhiệm vụ.');
        }

        const isBlood = task.orderItem.service.modality === 'blood_test';
        if (!isBlood && (dto.specimenCode || dto.specimenCollectedAt)) {
            throw new BadRequestException('Thông tin mẫu (specimenCode/specimenCollectedAt) chỉ áp dụng cho xét nghiệm máu.');
        }

        const now = new Date();
        const claim = await this.prisma.$transaction(async (tx) => {
            const result = await tx.diagnosticTask.updateMany({
                where: { taskId, status: 'ready', assignedStaffUserId: task.assignedStaffUserId },
                data: {
                    status: 'in_progress',
                    paymentVerified: true,
                    assignedStaffUserId: task.assignedStaffUserId ?? receivingUserId,
                    receivedAt: now,
                    startedAt: now,
                    ...(isBlood
                        ? {
                              specimenCode: dto.specimenCode ?? null,
                              specimenCollectedAt: dto.specimenCollectedAt ? new Date(dto.specimenCollectedAt) : now,
                          }
                        : {}),
                },
            });
            if (result.count > 0) {
                await this.progress.recomputeForTask(taskId, tx);
            }
            return result;
        });

        if (claim.count === 0) {
            const latest = await this.prisma.diagnosticTask.findUnique({ where: { taskId } });
            if (!latest) {
                throw new NotFoundException(`Không tìm thấy nhiệm vụ cận lâm sàng ${taskId}`);
            }
            if (latest.status !== 'ready') {
                throw new BadRequestException(
                    `Nhiệm vụ đang ở trạng thái '${latest.status}', chỉ có thể tiếp nhận khi ở trạng thái 'ready'.`,
                );
            }
            throw new ConflictException(
                `Nhiệm vụ vừa được kỹ thuật viên khác (${latest.assignedStaffUserId}) tiếp nhận trước đó, vui lòng tải lại danh sách.`,
            );
        }

        this.logger.log(`Đã tiếp nhận nhiệm vụ cận lâm sàng ${taskId}`);
        return this.prisma.diagnosticTask.findUniqueOrThrow({ where: { taskId } });
    }

    /**
     * Phòng báo cáo KHÔNG THỂ tiếp tục (mẫu từ chối, bệnh nhân vắng, trùng lặp, sự cố thiết bị...). Không phải huỷ:
     * task -> 'on_hold' và phát event để bác sĩ quyết định. Người gọi phải là LAB_STAFF.
     */
    async reportException(taskId: string, dto: ReportLabTaskExceptionDto, reportedByUserId: string) {
        await this.actorRoleService.assertActorRole(reportedByUserId, [ACTOR_ROLE.LAB_STAFF]);

        const task = await this.prisma.diagnosticTask.findUnique({ where: { taskId } });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ cận lâm sàng ${taskId}`);
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            const result = await tx.diagnosticTask.updateMany({
                where: { taskId, status: { notIn: ['completed', 'cancelled', 'on_hold'] } },
                data: { status: 'on_hold' },
            });
            if (result.count > 0) {
                await this.progress.recomputeForTask(taskId, tx);
            }
            return result;
        });

        if (updated.count === 0) {
            throw new BadRequestException(`Không thể báo cáo ngoại lệ cho nhiệm vụ đang ở trạng thái '${task.status}'.`);
        }

        this.logger.warn(
            `Nhiệm vụ ${taskId} chuyển 'on_hold' — lý do: ${dto.reasonCode}${dto.detail ? ` (${dto.detail})` : ''}. Chờ bác sĩ quyết định.`,
        );

        this.eventEmitter.emit(
            LAB_TASK_EXCEPTION_REPORTED_EVENT,
            new LabTaskExceptionReportedEvent(taskId, task.orderItemId, task.diagnosticRoomId, dto.reasonCode, dto.detail, reportedByUserId),
        );

        return this.prisma.diagnosticTask.findUnique({ where: { taskId } });
    }

    /**
     * Bác sĩ quyết định cho task 'on_hold': 'retry' (về 'ready', giữ paymentVerified, xoá KTV/mốc nhận cũ) hoặc
     * 'cancel' (dùng chung applyCancellationFromOrder). Người gọi BẮT BUỘC là DOCTOR.
     */
    async resolveException(taskId: string, dto: ResolveLabTaskExceptionDto, resolvedByUserId: string) {
        await this.actorRoleService.assertActorRole(resolvedByUserId, [ACTOR_ROLE.DOCTOR]);

        const task = await this.prisma.diagnosticTask.findUnique({ where: { taskId } });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ cận lâm sàng ${taskId}`);
        }
        if (task.status !== 'on_hold') {
            throw new BadRequestException(`Nhiệm vụ đang ở trạng thái '${task.status}', chỉ xử lý quyết định khi đang 'on_hold'.`);
        }

        if (dto.decision === 'cancel') {
            const cancelled = await this.applyCancellationFromOrder(task.orderItemId, resolvedByUserId, dto.reason);
            this.eventEmitter.emit(
                LAB_TASK_EXCEPTION_RESOLVED_EVENT,
                new LabTaskExceptionResolvedEvent(taskId, task.orderItemId, task.diagnosticRoomId, dto.decision, dto.reason, resolvedByUserId),
            );
            return cancelled;
        }

        const result = await this.prisma.$transaction(async (tx) => {
            const r = await tx.diagnosticTask.updateMany({
                where: { taskId, status: 'on_hold' },
                data: { status: 'ready', assignedStaffUserId: null, receivedAt: null, startedAt: null },
            });
            if (r.count > 0) {
                await this.progress.recomputeForTask(taskId, tx);
            }
            return r;
        });

        if (result.count === 0) {
            const latest = await this.prisma.diagnosticTask.findUnique({ where: { taskId } });
            throw new ConflictException(
                `Nhiệm vụ vừa được xử lý bởi một quyết định khác (trạng thái hiện tại: '${latest?.status}'), vui lòng tải lại thông tin.`,
            );
        }

        this.logger.log(`Bác sĩ ${resolvedByUserId} chọn 'retry' cho nhiệm vụ ${taskId} — quay về 'ready'.${dto.reason ? ` Ghi chú: ${dto.reason}` : ''}`);

        this.eventEmitter.emit(
            LAB_TASK_EXCEPTION_RESOLVED_EVENT,
            new LabTaskExceptionResolvedEvent(taskId, task.orderItemId, task.diagnosticRoomId, dto.decision, dto.reason, resolvedByUserId),
        );

        return this.prisma.diagnosticTask.findUnique({ where: { taskId } });
    }

    /**
     * NỘI BỘ — gọi từ LabTaskOrderCancellationListener ('order-item.cancelled' từ SE02) và từ resolveException
     * (nhánh 'cancel'). Đường DUY NHẤT khiến task thành 'cancelled'. Idempotent; không ghi đè task 'completed'.
     *
     * Cùng transaction: task -> cancelled, DiagnosticOrderItem -> cancelled (cần khi đi đường resolveException vì
     * lúc đó SE02 chưa đánh dấu item), rồi tính lại Order/Encounter (huỷ hết => Encounter về 'in_progress').
     */
    async applyCancellationFromOrder(orderItemId: string, cancelledByUserId: string, reason?: string) {
        const task = await this.prisma.diagnosticTask.findUnique({ where: { orderItemId } });
        if (!task) {
            this.logger.warn(`Nhận yêu cầu huỷ cho orderItemId ${orderItemId} nhưng không có DiagnosticTask tương ứng.`);
            return null;
        }

        if (task.status === 'completed') {
            this.logger.error(
                `Order item ${orderItemId} bị huỷ nhưng DiagnosticTask ${task.taskId} đã 'completed' — không tự động huỷ. ` +
                    'Cần xử lý qua luồng đính chính/huỷ kết quả.',
            );
            return task;
        }

        const changed = await this.prisma.$transaction(async (tx) => {
            const result = await tx.diagnosticTask.updateMany({
                where: { orderItemId, status: { not: 'completed' } },
                data: { status: 'cancelled' },
            });
            if (result.count === 0) return 0;

            await tx.diagnosticOrderItem.updateMany({
                where: { orderItemId, status: 'ordered' },
                data: { status: 'cancelled' },
            });
            await this.progress.recomputeForTask(task.taskId, tx);
            return result.count;
        });

        if (changed > 0) {
            this.logger.log(
                `DiagnosticTask ${task.taskId} chuyển 'cancelled' theo huỷ chỉ định ${orderItemId} bởi ${cancelledByUserId}${reason ? ` — lý do: ${reason}` : ''}.`,
            );
        }
        return this.prisma.diagnosticTask.findUnique({ where: { taskId: task.taskId } });
    }

    /** Dùng bởi LabResultService trước khi nhập kết quả: chỉ task 'in_progress' đã qua ràng buộc thanh toán. */
    async assertReadyForResultEntry(taskId: string) {
        const task = await this.prisma.diagnosticTask.findUnique({ where: { taskId } });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ cận lâm sàng ${taskId}`);
        }
        if (!task.paymentVerified) {
            throw new ForbiddenException('Không thể nhập kết quả: bệnh nhân chưa hoàn tất thanh toán cho chỉ định này.');
        }
        if (task.status !== 'in_progress') {
            throw new BadRequestException(
                `Nhiệm vụ đang ở trạng thái '${task.status}'. Cần tiếp nhận (status 'in_progress') trước khi nhập kết quả.`,
            );
        }
        return task;
    }

    /** Đánh dấu hoàn tất — gọi bởi LabResultService trong cùng transaction lưu kết quả. */
    async markCompleted(taskId: string, db: Db = this.prisma) {
        return db.diagnosticTask.update({
            where: { taskId },
            data: { status: 'completed', completedAt: new Date() },
        });
    }
}
