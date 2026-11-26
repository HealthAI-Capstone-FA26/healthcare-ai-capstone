import {
    BadRequestException,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
import { TestOrderService } from '../../src/modules/clinical/pre-doctor-examination/test-order/test-order.service';
import { EncounterStatus } from '../../src/common/utils/encounter-status.util';
import { ORDER_ITEM_CANCELLED_EVENT } from '../../src/modules/clinical/pre-doctor-examination/test-order/events/order-item-cancelled.event';
import { CancelTestOrderItemDto } from '../../src/modules/clinical/pre-doctor-examination/test-order/dto/cancel-test-order-item.dto';

describe('TestOrderService - Function 16: cancelItem', () => {
    let service: TestOrderService;
    let mockTx: any;
    let mockPrismaService: any;
    let mockActorRoleService: any;
    let mockDoctorService: any;
    let mockAccessService: any;
    let mockEventEmitter: any;

    const orderItemId = 'item-001';
    const orderId = 'order-001';
    const encounterId = 'enc-001';
    const currentUserId = 'user-doc-001';
    const mockDoctor = { doctorId: 'doc-001' };

    const mockEncounter = {
        encounterId,
        doctorId: 'doc-001',
        status: EncounterStatus.IN_PROGRESS,
    };

    const mockOrderItemBase = {
        orderItemId,
        orderId,
        status: 'ordered',
        task: {
            taskId: 'task-001',
            orderItemId,
            status: 'payment_pending',
        },
        order: {
            orderId,
            encounterId,
            encounter: mockEncounter,
        },
    };

    beforeEach(() => {
        mockTx = {
            $executeRaw: jest.fn().mockResolvedValue(1),
            diagnosticOrderItem: {
                updateMany: jest.fn(),
                count: jest.fn(),
                findUniqueOrThrow: jest.fn(),
            },
            diagnosticTask: {
                updateMany: jest.fn(),
            },
            diagnosticOrder: {
                update: jest.fn(),
            },
        };

        mockPrismaService = {
            diagnosticOrderItem: {
                findUnique: jest.fn(),
            },
            $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) =>
                callback(mockTx),
            ),
        };

        mockActorRoleService = {
            assertActorRole: jest.fn().mockResolvedValue(undefined),
        };

        mockDoctorService = {
            findByUserId: jest.fn().mockResolvedValue(mockDoctor),
        };

        mockAccessService = {
            assertOwnedBy: jest.fn().mockReturnValue(undefined),
        };

        mockEventEmitter = {
            emit: jest.fn(),
        };

        service = new TestOrderService(
            mockPrismaService as any,
            mockActorRoleService as any,
            mockDoctorService as any,
            mockAccessService as any,
            mockEventEmitter as any,
        );
    });

    // UTCID01 [Normal]: Exists in encounter, status = "ordered", task.status = "payment_pending", remaining items > 0
    it('UTCID01 [Normal]: should cancel unpaid diagnostic order item when remaining items exist in the order', async () => {
        const dto: CancelTestOrderItemDto = {
            reason: 'Bệnh nhân chưa thanh toán, đổi dịch vụ khác',
        };

        mockPrismaService.diagnosticOrderItem.findUnique.mockResolvedValue(mockOrderItemBase);
        mockTx.diagnosticOrderItem.updateMany.mockResolvedValue({ count: 1 });
        mockTx.diagnosticTask.updateMany.mockResolvedValue({ count: 1 });
        mockTx.diagnosticOrderItem.count.mockResolvedValue(1); // 1 item still remaining

        const cancelledItem = {
            ...mockOrderItemBase,
            status: 'cancelled',
            task: { ...mockOrderItemBase.task, status: 'cancelled' },
        };
        mockTx.diagnosticOrderItem.findUniqueOrThrow.mockResolvedValue(cancelledItem);

        const result = await service.cancelItem(orderItemId, dto, currentUserId);

        expect(mockActorRoleService.assertActorRole).toHaveBeenCalledWith(currentUserId, ['DOCTOR']);
        expect(mockDoctorService.findByUserId).toHaveBeenCalledWith(currentUserId);
        expect(mockAccessService.assertOwnedBy).toHaveBeenCalledWith(mockEncounter, mockDoctor.doctorId);
        expect(mockTx.diagnosticOrderItem.updateMany).toHaveBeenCalledWith({
            where: { orderItemId, status: 'ordered' },
            data: { status: 'cancelled' },
        });
        expect(mockTx.diagnosticTask.updateMany).toHaveBeenCalledWith({
            where: { orderItemId, status: { in: ['payment_pending', 'on_hold'] } },
            data: { status: 'cancelled' },
        });
        expect(mockTx.diagnosticOrder.update).not.toHaveBeenCalled(); // Order not cancelled because items remain
        expect(mockEventEmitter.emit).toHaveBeenCalledWith(
            ORDER_ITEM_CANCELLED_EVENT,
            expect.objectContaining({ orderItemId, cancelledByUserId: currentUserId, reason: dto.reason }),
        );
        expect(result).toEqual(cancelledItem);
    });

    // UTCID02 [Normal]: Exists, status = "ordered", task.status = "payment_pending", remaining items = 0 -> Cancels entire order
    it('UTCID02 [Normal]: should cancel unpaid diagnostic order item and mark entire diagnostic order as cancelled when 0 remaining items', async () => {
        const dto: CancelTestOrderItemDto = {
            reason: 'Hủy hạng mục duy nhất chưa thanh toán của đơn',
        };

        mockPrismaService.diagnosticOrderItem.findUnique.mockResolvedValue(mockOrderItemBase);
        mockTx.diagnosticOrderItem.updateMany.mockResolvedValue({ count: 1 });
        mockTx.diagnosticTask.updateMany.mockResolvedValue({ count: 1 });
        mockTx.diagnosticOrderItem.count.mockResolvedValue(0); // 0 remaining

        const cancelledItem = {
            ...mockOrderItemBase,
            status: 'cancelled',
            task: { ...mockOrderItemBase.task, status: 'cancelled' },
        };
        mockTx.diagnosticOrderItem.findUniqueOrThrow.mockResolvedValue(cancelledItem);

        const result = await service.cancelItem(orderItemId, dto, currentUserId);

        expect(mockTx.diagnosticOrder.update).toHaveBeenCalledWith({
            where: { orderId },
            data: { status: 'cancelled' },
        });
        expect(result).toEqual(cancelledItem);
    });

    // UTCID03 [Abnormal]: Not found or belongs to different encounter
    it('UTCID03 [Abnormal]: should throw NotFoundException when order item is not found', async () => {
        const dto: CancelTestOrderItemDto = { reason: 'Test' };

        mockPrismaService.diagnosticOrderItem.findUnique.mockResolvedValue(null);

        await expect(service.cancelItem('missing-item', dto, currentUserId)).rejects.toThrow(
            NotFoundException,
        );
        await expect(service.cancelItem('missing-item', dto, currentUserId)).rejects.toThrow(
            'Không tìm thấy hạng mục chỉ định missing-item',
        );
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    // UTCID04 [Abnormal]: Already status = "cancelled"
    it('UTCID04 [Abnormal]: should throw BadRequestException when order item is already cancelled', async () => {
        const dto: CancelTestOrderItemDto = { reason: 'Test' };

        const alreadyCancelledItem = {
            ...mockOrderItemBase,
            status: 'cancelled',
        };
        mockPrismaService.diagnosticOrderItem.findUnique.mockResolvedValue(alreadyCancelledItem);

        await expect(service.cancelItem(orderItemId, dto, currentUserId)).rejects.toThrow(
            BadRequestException,
        );
        await expect(service.cancelItem(orderItemId, dto, currentUserId)).rejects.toThrow(
            "Không thể huỷ hạng mục đang ở trạng thái 'cancelled'.",
        );
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    // UTCID05 [Abnormal]: Task is already paid ("ready") or executing ("in_progress" / "completed") -> Reject with ConflictException
    it('UTCID05 [Abnormal]: should throw ConflictException when item has already been paid (ready) or in-progress/completed', async () => {
        const dto: CancelTestOrderItemDto = { reason: 'Muốn hủy sau khi bệnh nhân đã thanh toán phí' };

        const paidOrderItem = {
            ...mockOrderItemBase,
            task: {
                taskId: 'task-001',
                orderItemId,
                status: 'ready', // Already paid fee!
            },
        };
        mockPrismaService.diagnosticOrderItem.findUnique.mockResolvedValue(paidOrderItem);
        mockTx.diagnosticOrderItem.updateMany.mockResolvedValue({ count: 1 });
        mockTx.diagnosticTask.updateMany.mockResolvedValue({ count: 0 }); // 0 updated because 'ready' is not in TASK_CANCELLABLE_STATUSES

        await expect(service.cancelItem(orderItemId, dto, currentUserId)).rejects.toThrow(
            ConflictException,
        );
        await expect(service.cancelItem(orderItemId, dto, currentUserId)).rejects.toThrow(
            /Hạng mục đã được thanh toán hoặc đang\/đã được thực hiện, không thể huỷ chỉ định/i,
        );
        expect(mockEventEmitter.emit).not.toHaveBeenCalled();
    });

    // UTCID06 [Boundary]: Boundary cancellable status "on_hold" (Unpaid but held) -> Cancelled successfully
    it('UTCID06 [Boundary]: should successfully cancel diagnostic item when task is in boundary on_hold status', async () => {
        const dto: CancelTestOrderItemDto = { reason: 'Hủy hạng mục đang on_hold' };

        const onHoldOrderItem = {
            ...mockOrderItemBase,
            task: {
                taskId: 'task-001',
                orderItemId,
                status: 'on_hold',
            },
        };
        mockPrismaService.diagnosticOrderItem.findUnique.mockResolvedValue(onHoldOrderItem);
        mockTx.diagnosticOrderItem.updateMany.mockResolvedValue({ count: 1 });
        mockTx.diagnosticTask.updateMany.mockResolvedValue({ count: 1 });
        mockTx.diagnosticOrderItem.count.mockResolvedValue(1);

        const cancelledItem = {
            ...onHoldOrderItem,
            status: 'cancelled',
            task: { ...onHoldOrderItem.task, status: 'cancelled' },
        };
        mockTx.diagnosticOrderItem.findUniqueOrThrow.mockResolvedValue(cancelledItem);

        const result = await service.cancelItem(orderItemId, dto, currentUserId);

        expect(mockTx.diagnosticTask.updateMany).toHaveBeenCalledWith({
            where: { orderItemId, status: { in: ['payment_pending', 'on_hold'] } },
            data: { status: 'cancelled' },
        });
        expect(result).toEqual(cancelledItem);
    });
});
