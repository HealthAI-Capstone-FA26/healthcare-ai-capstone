import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { LabTaskService } from '../../src/modules/lab-test/lab-task-intake/lab-task.service';
import { ACTOR_ROLE } from '../../src/common/constants/actor-role.constant';

// @nestjs/event-emitter phát hành ESM — Jest (CJS) không nạp được; chỉ cần kiểu cho constructor nên mock rỗng.
jest.mock('@nestjs/event-emitter', () => ({ EventEmitter2: class {}, OnEvent: () => () => undefined }));

/**
 * WF-03 · F-09 "Test execution" — acceptance: "An unpaid task cannot be received".
 * Function 17 (Report5, mở rộng cho F-09 – commitment gán TC-F17): LabTaskService.receive(taskId, receivingUserId, dto) -> UTCID14..21
 *
 * Điểm chặn thanh toán: task chỉ được 'ready' -> 'in_progress' khi paymentVerified = true (hoặc hoá đơn đã paid).
 */
describe('LabTaskService - Function 17 (F-09): receive', () => {
    const TASK_ID = 'task-001';
    const STAFF_ID = 'staff-001';

    type TaskOverrides = Partial<{
        status: string;
        paymentVerified: boolean;
        assignedStaffUserId: string | null;
        modality: string;
    }>;

    const buildTask = (o: TaskOverrides = {}) => ({
        taskId: TASK_ID,
        orderItemId: 'item-001',
        diagnosticRoomId: 'room-blood',
        status: o.status ?? 'ready',
        paymentVerified: o.paymentVerified ?? true,
        assignedStaffUserId: o.assignedStaffUserId ?? null,
        orderItem: { service: { modality: o.modality ?? 'blood_test' } },
    });

    const makeHarness = (task: ReturnType<typeof buildTask> | null) => {
        const tx = { diagnosticTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
        const prisma = {
            diagnosticTask: {
                findUnique: jest.fn().mockResolvedValue(task),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                update: jest.fn().mockResolvedValue({}),
                findUniqueOrThrow: jest.fn().mockResolvedValue({ taskId: TASK_ID, status: 'in_progress', paymentVerified: true }),
            },
            $transaction: jest.fn(async (cb: any) => cb(tx)),
        };
        const labRoomService = { isStaffAssignedToRoom: jest.fn().mockResolvedValue(true) };
        const paymentVerification = { isOrderItemPaid: jest.fn().mockResolvedValue(true) };
        const eventEmitter = { emit: jest.fn() };
        const actorRoleService = { assertActorRole: jest.fn().mockResolvedValue(undefined) };
        const progress = { recomputeForTask: jest.fn().mockResolvedValue(null) };

        const service = new LabTaskService(
            prisma as any,
            labRoomService as any,
            paymentVerification as any,
            eventEmitter as any,
            actorRoleService as any,
            progress as any,
        );
        return { service, prisma, tx, labRoomService, paymentVerification, actorRoleService, progress };
    };

    // UTCID14: Normal - task 'ready', đã thanh toán, đúng KTV -> in_progress, cập nhật Order/Encounter cùng transaction
    it('UTCID14 [N]: should move a paid ready task to in_progress and recompute order/encounter in the same transaction', async () => {
        const h = makeHarness(buildTask());

        const result: any = await h.service.receive(TASK_ID, STAFF_ID, { specimenCode: 'SP-0001' } as any);

        expect(h.actorRoleService.assertActorRole).toHaveBeenCalledWith(STAFF_ID, [ACTOR_ROLE.LAB_STAFF]);
        expect(h.paymentVerification.isOrderItemPaid).not.toHaveBeenCalled(); // cờ paymentVerified đã bật -> không cần tra hoá đơn
        expect(h.tx.diagnosticTask.updateMany).toHaveBeenCalledWith({
            where: { taskId: TASK_ID, status: 'ready', assignedStaffUserId: null },
            data: expect.objectContaining({
                status: 'in_progress',
                paymentVerified: true,
                assignedStaffUserId: STAFF_ID,
                specimenCode: 'SP-0001',
                receivedAt: expect.any(Date),
                startedAt: expect.any(Date),
            }),
        });
        expect(h.progress.recomputeForTask).toHaveBeenCalledWith(TASK_ID, h.tx);
        expect(result.status).toBe('in_progress');
    });

    // UTCID15: Abnormal - acceptance criterion F-09: task chưa thanh toán KHÔNG được tiếp nhận
    it('UTCID15 [A]: should throw ForbiddenException when the task is unpaid (paymentVerified = false and invoice not paid)', async () => {
        const h = makeHarness(buildTask({ paymentVerified: false, status: 'payment_pending' }));
        h.paymentVerification.isOrderItemPaid.mockResolvedValue(false);

        await expect(h.service.receive(TASK_ID, STAFF_ID)).rejects.toThrow(ForbiddenException);
        await expect(h.service.receive(TASK_ID, STAFF_ID)).rejects.toThrow(/chưa hoàn tất thanh toán/);

        expect(h.paymentVerification.isOrderItemPaid).toHaveBeenCalledWith('item-001');
        expect(h.prisma.$transaction).not.toHaveBeenCalled(); // không chiếm task
        expect(h.prisma.diagnosticTask.updateMany).not.toHaveBeenCalled(); // không nâng lên 'ready'
        expect(h.progress.recomputeForTask).not.toHaveBeenCalled();
    });

    // UTCID16: Boundary - hoá đơn đã paid nhưng webhook chưa kịp báo (task còn payment_pending) -> tự nâng 'ready' rồi nhận
    it('UTCID16 [B]: should promote a payment_pending task to ready when its invoice is already paid, then receive it', async () => {
        const h = makeHarness(buildTask({ paymentVerified: false, status: 'payment_pending' }));
        h.paymentVerification.isOrderItemPaid.mockResolvedValue(true);

        await h.service.receive(TASK_ID, STAFF_ID);

        expect(h.prisma.diagnosticTask.updateMany).toHaveBeenCalledWith({
            where: { taskId: TASK_ID, status: 'payment_pending' },
            data: expect.objectContaining({ paymentVerified: true, status: 'ready', readyAt: expect.any(Date) }),
        });
        expect(h.tx.diagnosticTask.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { taskId: TASK_ID, status: 'ready', assignedStaffUserId: null } }),
        );
        expect(h.progress.recomputeForTask).toHaveBeenCalledTimes(1);
    });

    // UTCID17: Abnormal - không tìm thấy nhiệm vụ
    it('UTCID17 [A]: should throw NotFoundException when the diagnostic task does not exist', async () => {
        const h = makeHarness(null);

        await expect(h.service.receive('task-missing', STAFF_ID)).rejects.toThrow(NotFoundException);

        expect(h.paymentVerification.isOrderItemPaid).not.toHaveBeenCalled();
        expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });

    // UTCID18: Abnormal - task đã được tiếp nhận (in_progress) -> chỉ 'ready' mới được nhận
    it("UTCID18 [A]: should throw BadRequestException when the task is not in 'ready' status", async () => {
        const h = makeHarness(buildTask({ status: 'in_progress' }));

        await expect(h.service.receive(TASK_ID, STAFF_ID)).rejects.toThrow(BadRequestException);
        await expect(h.service.receive(TASK_ID, STAFF_ID)).rejects.toThrow(/chỉ có thể tiếp nhận khi ở trạng thái 'ready'/);

        expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });

    // UTCID19: Abnormal - task đã pre-assign cho KTV khác
    it('UTCID19 [A]: should throw ForbiddenException when the task is pre-assigned to another lab staff', async () => {
        const h = makeHarness(buildTask({ assignedStaffUserId: 'staff-other' }));

        await expect(h.service.receive(TASK_ID, STAFF_ID)).rejects.toThrow(ForbiddenException);
        await expect(h.service.receive(TASK_ID, STAFF_ID)).rejects.toThrow(/đã được phân công cho kỹ thuật viên khác/);

        expect(h.labRoomService.isStaffAssignedToRoom).not.toHaveBeenCalled();
        expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });

    // UTCID20: Abnormal - người gọi không phải LAB_STAFF (RBAC) -> chặn trước khi đọc DB
    it('UTCID20 [A]: should reject a caller whose actor role is not LAB_STAFF before touching the task', async () => {
        const h = makeHarness(buildTask());
        h.actorRoleService.assertActorRole.mockRejectedValue(new ForbiddenException('Không đủ quyền'));

        await expect(h.service.receive(TASK_ID, 'user-patient')).rejects.toThrow(ForbiddenException);

        expect(h.prisma.diagnosticTask.findUnique).not.toHaveBeenCalled();
        expect(h.prisma.$transaction).not.toHaveBeenCalled();
    });

    // UTCID21: Boundary - 2 KTV cùng nhận 1 task: compare-and-swap thua (count = 0) -> 409, không recompute
    it('UTCID21 [B]: should throw ConflictException when another lab staff claims the same task first (compare-and-swap loses)', async () => {
        const task = buildTask();
        const h = makeHarness(task);
        h.tx.diagnosticTask.updateMany.mockResolvedValue({ count: 0 });
        h.prisma.diagnosticTask.findUnique
            .mockResolvedValueOnce(task) // lần đọc đầu trong receive()
            .mockResolvedValueOnce({ ...task, assignedStaffUserId: 'staff-002' }); // đọc lại sau khi thua CAS

        await expect(h.service.receive(TASK_ID, STAFF_ID)).rejects.toThrow(ConflictException);

        expect(h.progress.recomputeForTask).not.toHaveBeenCalled();
    });
});
