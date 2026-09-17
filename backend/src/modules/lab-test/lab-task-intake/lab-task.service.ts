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
import { PrismaService } from '../../../../prisma/prisma.service';
import { LabRoomService } from '../lab-room-catalog/lab-room.service';
import { PAYMENT_VERIFICATION_PORT, PaymentVerificationPort } from './payment-verification.port';
import { ListLabTasksQueryDto } from './dtos/list-lab-tasks-query.dto';
import { AssignLabTaskDto } from './dtos/assign-lab-task.dto';
import { ReportLabTaskExceptionDto } from './dtos/report-lab-task-exception.dto';
import { LAB_TASK_EXCEPTION_REPORTED_EVENT, LabTaskExceptionReportedEvent } from './events/lab-task-exception-reported.event';
import { ResolveLabTaskExceptionDto } from './dtos/resolve-lab-task-exception.dto';
import { LAB_TASK_EXCEPTION_RESOLVED_EVENT, LabTaskExceptionResolvedEvent } from './events/lab-task-exception-resolved.event';
import { ActorRoleService } from '../../user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';

/**
 * Tiếp nhận & vòng đời của 1 LabTask (nhiệm vụ xét nghiệm ứng với 1 TestOrderItem):
 *   payment_pending -> ready -> in_progress -> completed
 *                            -> on_hold (phòng Lab báo cáo ngoại lệ, chờ bác sĩ quyết định)
 *                                            -> ready      (bác sĩ chọn 'retry' — xem resolveException)
 *                                            -> cancelled  (bác sĩ chọn 'cancel' — xem resolveException,
 *                                               dùng chung logic với applyCancellationFromOrder; đây cũng
 *                                               là nhánh sẽ chạy khi module Order cascade xuống thật sự
 *                                               qua OrderItemCancelledEvent)
 *
 * QUAN TRỌNG — phòng Lab KHÔNG có quyền chủ động huỷ một chỉ định xét nghiệm (không có action
 * `cancel()` công khai). Trên thực tế bệnh viện, phòng Lab bắt buộc phải thực hiện mọi chỉ định
 * của bác sĩ; nó chỉ có thể *báo cáo ngoại lệ* (xem `reportException`) khi có trở ngại vận hành
 * (mẫu hỏng, bệnh nhân không có mặt...). Quyết định "không cần xét nghiệm nữa" luôn thuộc về bác sĩ/
 * module Order, và được phản ánh xuống LabTask qua sự kiện `OrderItemCancelledEvent` (cascade một chiều).
 *
 * RÀNG BUỘC THANH TOÁN (bắt buộc cho mọi bước "tiến hành xét nghiệm"): một LabTask chỉ được
 * chuyển sang 'in_progress' (tiếp nhận thực hiện) khi paymentVerified = true. Việc kiểm tra này
 * được thực hiện ở tầng service — không tin tưởng client — nên dù request đến từ đâu
 * (UI, API khác, script) đều bị chặn nếu bệnh nhân chưa thanh toán.
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
    ) { }

    /** Worklist của 1 phòng Lab — nền tảng để kỹ thuật viên biết cần tiếp nhận/xử lý task nào. */
    async listWorklist(query: ListLabTasksQueryDto) {
        return this.prisma.labTask.findMany({
            where: {
                labRoomId: query.labRoomId,
                ...(query.status ? { status: query.status } : {}),
                ...(query.assignedLabStaffId ? { assignedLabStaffId: query.assignedLabStaffId } : {}),
            },
            orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
            take: query.limit ?? 50,
            include: {
                labRoom: true,
                assignedLabStaff: {
                    include: {
                        profile: true,
                    },
                },
                orderItem: {
                    include: {
                        testType: {
                            include: {
                                labResultParameters: {
                                    where: { isActive: true },
                                    orderBy: { displayOrder: 'asc' },
                                    include: { labParameterThresholds: true },
                                },
                            },
                        },
                        order: {
                            include: {
                                orderedByUser: {
                                    include: {
                                        profile: true,
                                    },
                                },
                                encounter: {
                                    include: {
                                        patient: true,
                                    },
                                },
                            },
                        },
                    },
                },
                labResult: {
                    include: {
                        values: {
                            include: {
                                parameter: true,
                            },
                        },
                        attachments: true,
                    },
                },
            },
        });
    }

    async getById(labTaskId: string) {
        const task = await this.prisma.labTask.findUnique({
            where: { labTaskId },
            include: {
                labRoom: true,
                assignedLabStaff: {
                    include: {
                        profile: true,
                    },
                },
                orderItem: {
                    include: {
                        testType: {
                            include: {
                                labResultParameters: {
                                    where: { isActive: true },
                                    orderBy: { displayOrder: 'asc' },
                                    include: { labParameterThresholds: true },
                                },
                            },
                        },
                        order: {
                            include: {
                                orderedByUser: {
                                    include: {
                                        profile: true,
                                    },
                                },
                                encounter: {
                                    include: {
                                        patient: true,
                                    },
                                },
                            },
                        },
                    },
                },
                labResult: {
                    include: {
                        values: {
                            include: {
                                parameter: true,
                                labResultAlerts: true,
                            },
                        },
                        attachments: true,
                        aiLabAnalyses: true,
                    },
                },
            },
        });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ xét nghiệm ${labTaskId}`);
        }
        return task;
    }

    /**
     * Được module Thanh toán gọi (webhook/event) ngay khi hoá đơn của order item này được
     * thanh toán thành công. Idempotent: gọi lại nhiều lần không gây lỗi và không lùi trạng thái
     * nếu task đã tiến xa hơn 'ready' (VD: đã in_progress/completed).
     */
    async verifyPayment(labTaskId: string) {
        const task = await this.prisma.labTask.findUnique({ where: { labTaskId } });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ xét nghiệm ${labTaskId}`);
        }

        const updated = await this.prisma.labTask.update({
            where: { labTaskId },
            data: {
                paymentVerified: true,
                status: task.status === 'payment_pending' ? 'ready' : task.status,
            },
        });

        this.logger.log(`Đã xác nhận thanh toán cho nhiệm vụ xét nghiệm ${labTaskId}`);
        return updated;
    }

    /**
     * Gán/đổi kỹ thuật viên phụ trách — phải thuộc đúng phòng Lab của nhiệm vụ.
     *
     * Dùng cho 2 tình huống mà `receive()` không xử lý:
     *   1. Pre-assign: chỉ định trước một KTV cụ thể cho task đang 'ready' (VD: mẫu ưu tiên,
     *      cần continuity với 1 bệnh nhân) trước khi ai đó kịp tự nhận qua `receive()`.
     *   2. Reassign/transfer: chuyển task đang 'in_progress' sang KTV khác (VD: KTV đang cầm task
     *      nghỉ đột xuất giữa ca). `receive()` không cover được vì nó chỉ chạy 1 lần lúc 'ready' -> 'in_progress'.
     *
     * Không áp dụng cho task đã kết thúc vòng đời ('completed'/'cancelled') — gán lúc đó vô nghĩa
     * và có thể gây hiểu nhầm khi tra cứu lại ai phụ trách một task đã xong.
     *
     * `actingUserId` (lấy từ JWT của người gọi API, xem LabTaskController.assign) phải có
     * actorRole LAB_STAFF — chỉ phòng Lab mới được điều phối lại KTV của chính phòng mình.
     */
    async assign(labTaskId: string, dto: AssignLabTaskDto, actingUserId: string) {
        await this.actorRoleService.assertActorRole(actingUserId, [ACTOR_ROLE.LAB_STAFF]);

        const task = await this.prisma.labTask.findUnique({ where: { labTaskId } });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ xét nghiệm ${labTaskId}`);
        }

        if (task.status === 'completed' || task.status === 'cancelled') {
            throw new BadRequestException(
                `Không thể gán kỹ thuật viên cho nhiệm vụ đang ở trạng thái '${task.status}'.`,
            );
        }

        const isAssigned = await this.labRoomService.isStaffAssignedToRoom(dto.assignedLabStaffId, task.labRoomId);
        if (!isAssigned) {
            throw new BadRequestException('Kỹ thuật viên này chưa được phân quyền vào phòng Lab của nhiệm vụ.');
        }

        if (dto.assignedLabStaffId === task.assignedLabStaffId) {
            // Không có gì thay đổi — tránh ghi log/nhiễu audit trail cho no-op.
            return task;
        }

        const previousLabStaffId = task.assignedLabStaffId;
        const updated = await this.prisma.labTask.update({
            where: { labTaskId },
            data: { assignedLabStaffId: dto.assignedLabStaffId },
        });

        // TODO: khi có bảng LabTaskAssignmentHistory, ghi thêm 1 record ở đây (fromUserId,
        // toUserId, action, actorUserId) để trace được toàn bộ lịch sử gán/chuyển task khi có sự cố.
        if (previousLabStaffId && task.status === 'in_progress') {
            this.logger.warn(
                `REASSIGN: nhiệm vụ xét nghiệm ${labTaskId} đang 'in_progress' được chuyển từ KTV ${previousLabStaffId} sang KTV ${dto.assignedLabStaffId}.`,
            );
        } else if (previousLabStaffId) {
            this.logger.log(
                `Đổi kỹ thuật viên phụ trách nhiệm vụ xét nghiệm ${labTaskId}: ${previousLabStaffId} -> ${dto.assignedLabStaffId}.`,
            );
        } else {
            this.logger.log(
                `Gán trước (pre-assign) kỹ thuật viên ${dto.assignedLabStaffId} cho nhiệm vụ xét nghiệm ${labTaskId}.`,
            );
        }

        return updated;
    }

    /**
     * Kỹ thuật viên tiếp nhận chỉ định để bắt đầu thực hiện: 'ready' -> 'in_progress'.
     * Đây là điểm chặn chính của ràng buộc thanh toán trong toàn bộ luồng.
     *
     * CONCURRENCY: việc "chiếm" task (set assignedLabStaffId + chuyển status) được thực hiện bằng
     * một updateMany với điều kiện atomic trong WHERE (Compare-And-Swap), thay vì đọc rồi ghi
     * (read-then-write). Nhờ đó nếu 2 KTV cùng bấm "Nhận mẫu" cho 1 task đang trống cùng lúc,
     * DB đảm bảo chỉ 1 request thắng — request thua nhận lỗi 409 thay vì âm thầm ghi đè.
     */
    async receive(labTaskId: string, receivingLabStaffId: string) {
        await this.actorRoleService.assertActorRole(receivingLabStaffId, [ACTOR_ROLE.LAB_STAFF]);

        const task = await this.prisma.labTask.findUnique({ where: { labTaskId } });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ xét nghiệm ${labTaskId}`);
        }

        if (!task.paymentVerified) {
            // Phòng thủ 2 lớp: dù trạng thái có lỡ là 'ready' do lỗi dữ liệu, vẫn chặn cứng ở đây.
            const paid = await this.paymentVerification.isOrderItemPaid(task.orderItemId);
            if (!paid) {
                throw new ForbiddenException(
                    'Không thể tiếp nhận xét nghiệm: bệnh nhân chưa hoàn tất thanh toán cho chỉ định này.',
                );
            }
        }

        if (task.status === 'payment_pending') {
            throw new ForbiddenException(
                'Không thể tiếp nhận xét nghiệm: bệnh nhân chưa hoàn tất thanh toán cho chỉ định này.',
            );
        }
        if (task.status !== 'ready') {
            throw new BadRequestException(
                `Nhiệm vụ đang ở trạng thái '${task.status}', chỉ có thể tiếp nhận khi ở trạng thái 'ready'.`,
            );
        }

        // Nếu task đã được trưởng phòng gán sẵn (push) cho một KTV cụ thể, không cho phép người khác
        // "tiếp nhận giùm" — tránh xung đột trách nhiệm (task đứng tên A nhưng B lại là người thực nhận mẫu).
        if (task.assignedLabStaffId && receivingLabStaffId !== task.assignedLabStaffId) {
            throw new ForbiddenException(
                'Nhiệm vụ này đã được phân công cho kỹ thuật viên khác, bạn không thể tự tiếp nhận.',
            );
        }

        const isAssigned = await this.labRoomService.isStaffAssignedToRoom(receivingLabStaffId, task.labRoomId);
        if (!isAssigned) {
            throw new BadRequestException('Kỹ thuật viên này chưa được phân quyền vào phòng Lab của nhiệm vụ.');
        }

        const targetStaffId = task.assignedLabStaffId ?? receivingLabStaffId;
        const now = new Date();

        // Atomic claim (CAS): điều kiện `assignedLabStaffId: task.assignedLabStaffId` yêu cầu giá trị
        // trong DB phải đúng bằng giá trị vừa đọc được ở trên (thường là null trong luồng pull).
        // Nếu giữa lúc đọc và lúc ghi có KTV khác đã nhận task này trước, DB sẽ không còn khớp WHERE
        // -> count = 0 -> báo lỗi rõ ràng thay vì ghi đè người đã nhận trước.
        const result = await this.prisma.labTask.updateMany({
            where: {
                labTaskId,
                status: 'ready',
                assignedLabStaffId: task.assignedLabStaffId,
            },
            data: {
                status: 'in_progress',
                paymentVerified: true,
                assignedLabStaffId: targetStaffId,
                receivedAt: now,
                startedAt: now,
            },
        });

        if (result.count === 0) {
            const latest = await this.prisma.labTask.findUnique({ where: { labTaskId } });
            if (!latest) {
                throw new NotFoundException(`Không tìm thấy nhiệm vụ xét nghiệm ${labTaskId}`);
            }
            if (latest.status !== 'ready') {
                throw new BadRequestException(
                    `Nhiệm vụ đang ở trạng thái '${latest.status}', chỉ có thể tiếp nhận khi ở trạng thái 'ready'.`,
                );
            }
            throw new ConflictException(
                `Nhiệm vụ vừa được kỹ thuật viên khác (${latest.assignedLabStaffId}) tiếp nhận trước đó, vui lòng tải lại danh sách.`,
            );
        }

        const updated = await this.prisma.labTask.findUnique({ where: { labTaskId } });
        this.logger.log(`Đã tiếp nhận nhiệm vụ xét nghiệm ${labTaskId}`);
        return updated;
    }

    /**
     * Phòng Lab báo cáo KHÔNG THỂ tiếp tục thực hiện nhiệm vụ (mẫu bị từ chối, bệnh nhân không có
     * mặt, trùng lặp, sự cố thiết bị...). Đây không phải huỷ — task chuyển sang 'on_hold' (trạng
     * thái trung gian, không kết thúc) và phát event để bác sĩ/module Order biết mà quyết định
     * bước tiếp theo. Phòng Lab không tự đóng vòng đời của chính nhiệm vụ này.
     *
     * Không áp dụng cho task đã 'completed'/'cancelled' (đã kết thúc), hoặc đã 'on_hold' (đã báo
     * rồi, tránh spam event trùng lặp trong lúc chờ bác sĩ xử lý).
     *
     * `reportedByUserId` (lấy từ JWT, xem LabTaskController.reportException) phải có actorRole
     * LAB_STAFF.
     */
    async reportException(labTaskId: string, dto: ReportLabTaskExceptionDto, reportedByUserId: string) {
        await this.actorRoleService.assertActorRole(reportedByUserId, [ACTOR_ROLE.LAB_STAFF]);

        const task = await this.prisma.labTask.findUnique({ where: { labTaskId } });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ xét nghiệm ${labTaskId}`);
        }

        const result = await this.prisma.labTask.updateMany({
            where: {
                labTaskId,
                status: { notIn: ['completed', 'cancelled', 'on_hold'] },
            },
            data: { status: 'on_hold' },
        });

        if (result.count === 0) {
            throw new BadRequestException(
                `Không thể báo cáo ngoại lệ cho nhiệm vụ đang ở trạng thái '${task.status}'.`,
            );
        }

        this.logger.warn(
            `Nhiệm vụ xét nghiệm ${labTaskId} chuyển 'on_hold' — lý do: ${dto.reasonCode}` +
            `${dto.detail ? ` (${dto.detail})` : ''}. Chờ bác sĩ/module Order quyết định.`,
        );

        this.eventEmitter.emit(
            LAB_TASK_EXCEPTION_REPORTED_EVENT,
            new LabTaskExceptionReportedEvent(
                labTaskId,
                task.orderItemId,
                task.labRoomId,
                dto.reasonCode,
                dto.detail,
                reportedByUserId,
            ),
        );

        return this.prisma.labTask.findUnique({ where: { labTaskId } });
    }

    /**
     * Bác sĩ (qua module Order) đưa ra quyết định cho một nhiệm vụ đang 'on_hold' — trả lời cho
     * LabTaskExceptionReportedEvent đã phát trước đó ở `reportException`.
     *
     *   - decision = 'retry'  : yêu cầu lấy lại mẫu / thực hiện lại. Task quay về 'ready' như một
     *     lượt hoàn toàn mới: xoá KTV đã gán và mốc thời gian nhận/bắt đầu cũ (receivedAt/startedAt)
     *     để không gây hiểu nhầm khi tra lịch sử — nhưng GIỮ paymentVerified vì bệnh nhân không phải
     *     thanh toán lại cho cùng 1 chỉ định.
     *   - decision = 'cancel' : dùng LẠI đúng một đường xử lý huỷ với `applyCancellationFromOrder`
     *     (cùng logic sẽ chạy khi module Order thật sự cascade xuống qua OrderItemCancelledEvent),
     *     để không có 2 nguồn sự thật khác nhau cho việc "huỷ" một LabTask.
     *
     * Chỉ áp dụng khi task đang đúng 'on_hold' — tránh áp một quyết định cũ lên task đã được xử lý
     * hoặc đã tự thay đổi trạng thái bởi nhánh khác trong lúc chờ bác sĩ.
     *
     * `resolvedByUserId` (lấy từ JWT, xem LabTaskController.resolveException) BẮT BUỘC phải có
     * actorRole DOCTOR — đây là điểm chặn chính đảm bảo chỉ bác sĩ mới được quyết định huỷ/retry
     * một chỉ định, phòng Lab không thể tự gọi endpoint này để né qua `report-exception`.
     */
    async resolveException(labTaskId: string, dto: ResolveLabTaskExceptionDto, resolvedByUserId: string) {
        await this.actorRoleService.assertActorRole(resolvedByUserId, [ACTOR_ROLE.DOCTOR]);

        const task = await this.prisma.labTask.findUnique({ where: { labTaskId } });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ xét nghiệm ${labTaskId}`);
        }

        if (task.status !== 'on_hold') {
            throw new BadRequestException(
                `Nhiệm vụ đang ở trạng thái '${task.status}', chỉ có thể xử lý quyết định khi đang 'on_hold'.`,
            );
        }

        if (dto.decision === 'cancel') {
            const cancelled = await this.applyCancellationFromOrder(
                task.orderItemId,
                resolvedByUserId,
                dto.reason,
            );

            this.eventEmitter.emit(
                LAB_TASK_EXCEPTION_RESOLVED_EVENT,
                new LabTaskExceptionResolvedEvent(
                    labTaskId,
                    task.orderItemId,
                    task.labRoomId,
                    dto.decision,
                    dto.reason,
                    resolvedByUserId,
                ),
            );

            return cancelled;
        }

        // decision === 'retry': CAS trên status 'on_hold' — nếu giữa lúc đọc và ghi task đã bị
        // thay đổi bởi một request khác (VD: 2 lần bấm resolve gần nhau), count = 0 và ta báo lỗi
        // rõ ràng thay vì âm thầm ghi đè một trạng thái đã khác.
        const result = await this.prisma.labTask.updateMany({
            where: { labTaskId, status: 'on_hold' },
            data: {
                status: 'ready',
                assignedLabStaffId: null,
                receivedAt: null,
                startedAt: null,
            },
        });

        if (result.count === 0) {
            const latest = await this.prisma.labTask.findUnique({ where: { labTaskId } });
            throw new ConflictException(
                `Nhiệm vụ vừa được xử lý bởi một quyết định khác (trạng thái hiện tại: '${latest?.status}'), ` +
                'vui lòng tải lại thông tin.',
            );
        }

        this.logger.log(
            `Bác sĩ ${resolvedByUserId} chọn 'retry' cho nhiệm vụ xét nghiệm ${labTaskId} ` +
            `— quay về 'ready' để lấy lại mẫu.${dto.reason ? ` Ghi chú: ${dto.reason}` : ''}`,
        );

        this.eventEmitter.emit(
            LAB_TASK_EXCEPTION_RESOLVED_EVENT,
            new LabTaskExceptionResolvedEvent(
                labTaskId,
                task.orderItemId,
                task.labRoomId,
                dto.decision,
                dto.reason,
                resolvedByUserId,
            ),
        );

        return this.prisma.labTask.findUnique({ where: { labTaskId } });
    }

    /**
     * NỘI BỘ — được gọi từ 2 nơi:
     *   1. LabTaskOrderCancellationListener khi nhận OrderItemCancelledEvent từ module Order thật
     *      (bác sĩ huỷ chỉ định ngay từ đầu, task có thể đang ở bất kỳ trạng thái chưa kết thúc nào).
     *   2. resolveException() ở trên, nhánh decision = 'cancel' (bác sĩ huỷ SAU KHI phòng Lab báo
     *      cáo ngoại lệ và task đang 'on_hold').
     * Đây vẫn là con đường DUY NHẤT khiến một LabTask chuyển sang 'cancelled' — cascade một chiều
     * từ quyết định lâm sàng xuống, không phải hành động chủ động của phòng Lab.
     *
     * Idempotent: nếu task đã 'cancelled' rồi thì bỏ qua êm. Nếu task đã 'completed' (đã có kết
     * quả) thì KHÔNG được âm thầm ghi đè — đó phải là quyết định "đính chính/huỷ kết quả"
     * (LabResult.resultStatus) ở tầng LabResultService, không phải xoá dấu vết task đã xong.
     */
    async applyCancellationFromOrder(orderItemId: string, cancelledByUserId: string, reason?: string) {
        const task = await this.prisma.labTask.findUnique({ where: { orderItemId } });
        if (!task) {
            this.logger.warn(`Nhận yêu cầu huỷ cho orderItemId ${orderItemId} nhưng không có LabTask tương ứng.`);
            return null;
        }

        if (task.status === 'completed') {
            this.logger.error(
                `Order item ${orderItemId} bị huỷ nhưng LabTask ${task.labTaskId} đã 'completed' — ` +
                `không tự động huỷ. Cần xử lý qua flow đính chính/huỷ LabResult, không phải huỷ LabTask.`,
            );
            return task;
        }

        const result = await this.prisma.labTask.updateMany({
            where: { orderItemId, status: { not: 'completed' } },
            data: { status: 'cancelled' },
        });

        if (result.count === 0) {
            // Race hiếm: task vừa completed đúng lúc order bị huỷ — đã log ở nhánh trên khi đọc lần đầu,
            // nhưng đọc lại đảm bảo không bỏ sót do race giữa lúc đọc và lúc updateMany.
            return this.prisma.labTask.findUnique({ where: { orderItemId } });
        }

        this.logger.log(
            `LabTask ${task.labTaskId} chuyển 'cancelled' theo huỷ chỉ định order item ${orderItemId} ` +
            `bởi ${cancelledByUserId}${reason ? ` — lý do: ${reason}` : ''}.`,
        );

        return this.prisma.labTask.findUnique({ where: { labTaskId: task.labTaskId } });
    }

    /**
     * Dùng nội bộ bởi LabResultService trước khi cho nhập kết quả:
     * chỉ nhiệm vụ đang 'in_progress' (đã tiếp nhận, đã qua ràng buộc thanh toán) mới được nhập.
     */
    async assertReadyForResultEntry(labTaskId: string) {
        const task = await this.prisma.labTask.findUnique({ where: { labTaskId } });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ xét nghiệm ${labTaskId}`);
        }
        if (!task.paymentVerified) {
            throw new ForbiddenException(
                'Không thể nhập kết quả: bệnh nhân chưa hoàn tất thanh toán cho chỉ định này.',
            );
        }
        if (task.status !== 'in_progress') {
            throw new BadRequestException(
                `Nhiệm vụ đang ở trạng thái '${task.status}'. Cần tiếp nhận (status 'in_progress') trước khi nhập kết quả.`,
            );
        }
        return task;
    }

    /** Đánh dấu nhiệm vụ đã hoàn tất — gọi bởi LabResultService sau khi lưu kết quả thành công. */
    async markCompleted(labTaskId: string) {
        return this.prisma.labTask.update({
            where: { labTaskId },
            data: { status: 'completed', completedAt: new Date() },
        });
    }
}