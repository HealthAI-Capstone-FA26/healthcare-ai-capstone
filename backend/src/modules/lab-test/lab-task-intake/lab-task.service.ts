import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { LabRoomService } from '../lab-room-catalog/lab-room.service';
import { PAYMENT_VERIFICATION_PORT, PaymentVerificationPort } from './payment-verification.port';
import { ListLabTasksQueryDto } from './dtos/list-lab-tasks-query.dto';
import { AssignLabTaskDto } from './dtos/assign-lab-task.dto';
import { ReceiveLabTaskDto } from './dtos/receive-lab-task.dto';
import { CancelLabTaskDto } from './dtos/cancel-lab-task.dto';

/**
 * Tiếp nhận & vòng đời của 1 LabTask (nhiệm vụ xét nghiệm ứng với 1 TestOrderItem):
 *   payment_pending -> ready -> in_progress -> completed
 *                                            -> cancelled (có thể huỷ ở bất kỳ bước nào trước completed)
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
    ) {}

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
                assignedLabStaff: true,
                orderItem: true,
                labResult: true,
            },
        });
    }

    async getById(labTaskId: string) {
        const task = await this.prisma.labTask.findUnique({
            where: { labTaskId },
            include: {
                labRoom: true,
                assignedLabStaff: true,
                orderItem: true,
                labResult: { include: { values: { include: { parameter: true } }, attachments: true } },
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

    /** Gán/đổi kỹ thuật viên phụ trách — phải thuộc đúng phòng Lab của nhiệm vụ. */
    async assign(labTaskId: string, dto: AssignLabTaskDto) {
        const task = await this.prisma.labTask.findUnique({ where: { labTaskId } });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ xét nghiệm ${labTaskId}`);
        }

        const isAssigned = await this.labRoomService.isStaffAssignedToRoom(dto.assignedLabStaffId, task.labRoomId);
        if (!isAssigned) {
            throw new BadRequestException('Kỹ thuật viên này chưa được phân quyền vào phòng Lab của nhiệm vụ.');
        }

        return this.prisma.labTask.update({
            where: { labTaskId },
            data: { assignedLabStaffId: dto.assignedLabStaffId },
        });
    }

    /**
     * Kỹ thuật viên tiếp nhận chỉ định để bắt đầu thực hiện: 'ready' -> 'in_progress'.
     * Đây là điểm chặn chính của ràng buộc thanh toán trong toàn bộ luồng.
     */
    async receive(labTaskId: string, dto: ReceiveLabTaskDto) {
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

        const assignedLabStaffId = task.assignedLabStaffId ?? dto.receivingLabStaffId;
        if (dto.receivingLabStaffId) {
            const isAssigned = await this.labRoomService.isStaffAssignedToRoom(dto.receivingLabStaffId, task.labRoomId);
            if (!isAssigned) {
                throw new BadRequestException('Kỹ thuật viên này chưa được phân quyền vào phòng Lab của nhiệm vụ.');
            }
        }

        const now = new Date();
        const updated = await this.prisma.labTask.update({
            where: { labTaskId },
            data: {
                status: 'in_progress',
                paymentVerified: true,
                assignedLabStaffId,
                receivedAt: now,
                startedAt: now,
            },
        });

        this.logger.log(`Đã tiếp nhận nhiệm vụ xét nghiệm ${labTaskId}`);
        return updated;
    }

    async cancel(labTaskId: string, dto: CancelLabTaskDto) {
        const task = await this.prisma.labTask.findUnique({ where: { labTaskId } });
        if (!task) {
            throw new NotFoundException(`Không tìm thấy nhiệm vụ xét nghiệm ${labTaskId}`);
        }
        if (task.status === 'completed' || task.status === 'cancelled') {
            throw new BadRequestException(`Không thể huỷ nhiệm vụ đang ở trạng thái '${task.status}'.`);
        }

        this.logger.log(`Huỷ nhiệm vụ xét nghiệm ${labTaskId}${dto.reason ? ` — lý do: ${dto.reason}` : ''}`);
        return this.prisma.labTask.update({
            where: { labTaskId },
            data: { status: 'cancelled' },
        });
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
