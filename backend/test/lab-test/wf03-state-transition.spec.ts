import { BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException } from '@nestjs/common';
import { LabTaskService } from '../../src/modules/lab-test/lab-task-intake/lab-task.service';
import { DiagnosticProgressService } from '../../src/modules/lab-test/lab-task-intake/diagnostic-progress.service';
import { LabResultService } from '../../src/modules/lab-test/lab-result-entry/lab-result.service';
import { LabResultAlertService } from '../../src/modules/lab-test/lab-anomaly/lab-result-alert.service';
import { EcgRecordingService } from '../../src/modules/lab-test/ecg-recording/ecg-recording.service';
import { EcgAnomalyEventService } from '../../src/modules/lab-test/ecg-ai-analysis/ecg-anomaly-event.service';
import { LAB_TASK_EXCEPTION_REPORTED_EVENT } from '../../src/modules/lab-test/lab-task-intake/events/lab-task-exception-reported.event';
import { LAB_TASK_EXCEPTION_RESOLVED_EVENT } from '../../src/modules/lab-test/lab-task-intake/events/lab-task-exception-resolved.event';
import { LAB_RESULT_SUBMITTED_EVENT } from '../../src/modules/lab-test/lab-anomaly/events/lab-result-submitted.event';
import { ACTOR_ROLE } from '../../src/common/constants/actor-role.constant';

// @nestjs/event-emitter phát hành ESM — Jest (CJS) không nạp được; chỉ cần kiểu/decorator nên mock rỗng.
jest.mock('@nestjs/event-emitter', () => ({ EventEmitter2: class {}, OnEvent: () => () => undefined }));

/**
 * WF-03 — State transition tests (Commitment: "≥ 1 per transition"). Mỗi nhóm ST ứng với 1 đường trạng thái trong
 * "Main entity state path" của WF-03:
 *   ST-01 DiagnosticTask      : in_progress -> completed ; in_progress -> on_hold -> ready (retry)
 *   ST-02 DiagnosticOrder/Encounter : ordered -> in_progress -> completed ; awaiting_diagnostics -> diagnostics_in_progress -> awaiting_review
 *   ST-03 DiagnosticResult    : preliminary -> final / corrected
 *   ST-04 ResultValueAlert    : active -> confirmed -> resolved
 *   ST-05 EcgRecording        : -> cancelled
 *   ST-06 EcgAnomalyEvent.alertStatus : active -> acknowledged -> resolved
 */
describe('WF-03 state transitions', () => {
    beforeEach(() => {
        jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    });
    afterEach(() => {
        jest.restoreAllMocks();
    });

    // ==============================================================================================================
    describe('ST-01 DiagnosticTask: in_progress -> completed, in_progress -> on_hold -> ready', () => {
        const makeHarness = (task: any) => {
            const tx = { diagnosticTask: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) } };
            const prisma = {
                diagnosticTask: {
                    findUnique: jest.fn().mockResolvedValue(task),
                    findUniqueOrThrow: jest.fn(),
                    update: jest.fn().mockResolvedValue({}),
                },
                $transaction: jest.fn(async (cb: any) => cb(tx)),
            };
            const eventEmitter = { emit: jest.fn() };
            const actorRoleService = { assertActorRole: jest.fn().mockResolvedValue(undefined) };
            const progress = { recomputeForTask: jest.fn().mockResolvedValue(null) };
            const service = new LabTaskService(
                prisma as any,
                { isStaffAssignedToRoom: jest.fn() } as any,
                { isOrderItemPaid: jest.fn() } as any,
                eventEmitter as any,
                actorRoleService as any,
                progress as any,
            );
            return { service, prisma, tx, eventEmitter, actorRoleService, progress };
        };
        const task = (status: string) => ({ taskId: 'task-001', orderItemId: 'item-001', diagnosticRoomId: 'room-ecg', status });

        // ST-01.1: in_progress -> completed (markCompleted, dùng trong transaction lưu kết quả)
        it("ST-01.1: should move a task to 'completed' and stamp completedAt", async () => {
            const h = makeHarness(task('in_progress'));

            await h.service.markCompleted('task-001', h.prisma as any);

            expect(h.prisma.diagnosticTask.update).toHaveBeenCalledWith({
                where: { taskId: 'task-001' },
                data: { status: 'completed', completedAt: expect.any(Date) },
            });
        });

        // ST-01.2: in_progress -> on_hold (lab báo ngoại lệ), recompute Order/Encounter cùng transaction, phát event cho bác sĩ
        it("ST-01.2: should move an in_progress task to 'on_hold', recompute progress and emit the exception event", async () => {
            const h = makeHarness(task('in_progress'));
            h.prisma.diagnosticTask.findUnique.mockResolvedValue(task('on_hold')); // giá trị trả về cuối hàm

            await h.service.reportException('task-001', { reasonCode: 'specimen_rejected', detail: 'Mẫu bị huyết tán' } as any, 'staff-001');

            expect(h.actorRoleService.assertActorRole).toHaveBeenCalledWith('staff-001', [ACTOR_ROLE.LAB_STAFF]);
            expect(h.tx.diagnosticTask.updateMany).toHaveBeenCalledWith({
                where: { taskId: 'task-001', status: { notIn: ['completed', 'cancelled', 'on_hold'] } },
                data: { status: 'on_hold' },
            });
            expect(h.progress.recomputeForTask).toHaveBeenCalledWith('task-001', h.tx);
            expect(h.eventEmitter.emit).toHaveBeenCalledWith(
                LAB_TASK_EXCEPTION_REPORTED_EVENT,
                expect.objectContaining({ labTaskId: 'task-001', orderItemId: 'item-001', reasonCode: 'specimen_rejected', reportedByUserId: 'staff-001' }),
            );
        });

        // ST-01.3: transition không hợp lệ - task đã completed không thể on_hold
        it("ST-01.3: should reject on_hold for a task that is already 'completed' (no event, no recompute)", async () => {
            const h = makeHarness(task('completed'));
            h.tx.diagnosticTask.updateMany.mockResolvedValue({ count: 0 });

            await expect(h.service.reportException('task-001', { reasonCode: 'other' } as any, 'staff-001')).rejects.toThrow(BadRequestException);

            expect(h.progress.recomputeForTask).not.toHaveBeenCalled();
            expect(h.eventEmitter.emit).not.toHaveBeenCalled();
        });

        // ST-01.4: on_hold -> ready (bác sĩ chọn 'retry'): xoá KTV/mốc nhận cũ, giữ paymentVerified
        it("ST-01.4: should return an on_hold task to 'ready' on a doctor's retry decision, clearing assignee and timestamps", async () => {
            const h = makeHarness(task('on_hold'));

            await h.service.resolveException('task-001', { decision: 'retry', reason: 'Lấy mẫu lại' } as any, 'doc-001');

            expect(h.actorRoleService.assertActorRole).toHaveBeenCalledWith('doc-001', [ACTOR_ROLE.DOCTOR]);
            expect(h.tx.diagnosticTask.updateMany).toHaveBeenCalledWith({
                where: { taskId: 'task-001', status: 'on_hold' },
                data: { status: 'ready', assignedStaffUserId: null, receivedAt: null, startedAt: null }, // không đụng paymentVerified
            });
            expect(h.progress.recomputeForTask).toHaveBeenCalledWith('task-001', h.tx);
            expect(h.eventEmitter.emit).toHaveBeenCalledWith(
                LAB_TASK_EXCEPTION_RESOLVED_EVENT,
                expect.objectContaining({ labTaskId: 'task-001', decision: 'retry', resolvedByUserId: 'doc-001' }),
            );
        });

        // ST-01.5: transition không hợp lệ - quyết định cho task không ở on_hold
        it("ST-01.5: should reject a resolve decision when the task is not 'on_hold'", async () => {
            const h = makeHarness(task('in_progress'));

            await expect(h.service.resolveException('task-001', { decision: 'retry' } as any, 'doc-001')).rejects.toThrow(/chỉ xử lý quyết định khi đang 'on_hold'/);

            expect(h.prisma.$transaction).not.toHaveBeenCalled();
            expect(h.eventEmitter.emit).not.toHaveBeenCalled();
        });

        // ST-01.6: 2 quyết định đồng thời - CAS thua -> 409
        it('ST-01.6: should throw ConflictException when another decision resolved the on_hold task first', async () => {
            const h = makeHarness(task('on_hold'));
            h.tx.diagnosticTask.updateMany.mockResolvedValue({ count: 0 });
            h.prisma.diagnosticTask.findUnique.mockResolvedValueOnce(task('on_hold')).mockResolvedValueOnce(task('ready'));

            await expect(h.service.resolveException('task-001', { decision: 'retry' } as any, 'doc-001')).rejects.toThrow(ConflictException);

            expect(h.eventEmitter.emit).not.toHaveBeenCalled();
        });
    });

    // ==============================================================================================================
    describe('ST-02 DiagnosticOrder / Encounter derived from task statuses (DiagnosticProgressService)', () => {
        /** Prisma in-memory tối thiểu: 1 encounter, 1 order, N item (mỗi item 1 task). */
        const makeState = (encounterStatus: string, taskStatuses: string[]) => {
            const state = {
                encounter: { encounterId: 'enc-001', status: encounterStatus },
                order: { orderId: 'ord-001', encounterId: 'enc-001', status: 'ordered', completedAt: null as Date | null },
                items: taskStatuses.map((s, i) => ({ orderItemId: `item-${i + 1}`, status: 'ordered', task: { taskId: `task-${i + 1}`, status: s } })),
            };
            const prisma = {
                diagnosticTask: {
                    findUnique: jest.fn(async () => ({ orderItem: { orderId: state.order.orderId, order: { encounterId: 'enc-001' } } })),
                },
                diagnosticOrder: {
                    findUnique: jest.fn(async () => ({
                        ...state.order,
                        items: state.items.map((i) => ({ status: i.status, task: { status: i.task.status } })),
                    })),
                    update: jest.fn(async ({ data }: any) => {
                        Object.assign(state.order, data);
                    }),
                    findMany: jest.fn(async () =>
                        state.order.status === 'cancelled'
                            ? []
                            : [{ items: state.items.filter((i) => i.status === 'ordered').map((i) => ({ task: { status: i.task.status } })) }],
                    ),
                },
                encounter: {
                    findUnique: jest.fn(async () => ({ status: state.encounter.status })),
                    updateMany: jest.fn(async ({ where, data }: any) => {
                        if (state.encounter.status !== where.status) return { count: 0 };
                        state.encounter.status = data.status;
                        return { count: 1 };
                    }),
                },
            };
            return { state, service: new DiagnosticProgressService(prisma as any), prisma };
        };

        // ST-02.1: không đổi trạng thái khi mọi task còn 'ready'
        it('ST-02.1: should keep order = ordered and encounter = awaiting_diagnostics while every task is still ready', async () => {
            const { state, service } = makeState('awaiting_diagnostics', ['ready', 'ready']);

            const snap = await service.recomputeForTask('task-1');

            expect(state.order.status).toBe('ordered');
            expect(state.encounter.status).toBe('awaiting_diagnostics');
            expect(snap).toMatchObject({ orderStatus: 'ordered', encounterStatusBefore: 'awaiting_diagnostics', encounterStatusAfter: 'awaiting_diagnostics', encounterBecameAwaitingReview: false });
        });

        // ST-02.2: task đầu tiên được nhận -> order in_progress, encounter diagnostics_in_progress
        it('ST-02.2: should move order -> in_progress and encounter -> diagnostics_in_progress when the first task is received', async () => {
            const { state, service } = makeState('awaiting_diagnostics', ['in_progress', 'ready']);

            const snap = await service.recomputeForTask('task-1');

            expect(state.order.status).toBe('in_progress');
            expect(state.encounter.status).toBe('diagnostics_in_progress');
            expect(snap).toMatchObject({ encounterStatusBefore: 'awaiting_diagnostics', encounterStatusAfter: 'diagnostics_in_progress', encounterBecameAwaitingReview: false });
        });

        // ST-02.3: mọi task completed -> order completed (+completedAt), encounter awaiting_review, cờ gửi thông báo hoàn tất = true
        it('ST-02.3: should move order -> completed and encounter -> awaiting_review (notify flag on) when all tasks complete', async () => {
            const { state, service } = makeState('diagnostics_in_progress', ['completed', 'completed']);

            const snap = await service.recomputeForTask('task-2');

            expect(state.order.status).toBe('completed');
            expect(state.order.completedAt).toBeInstanceOf(Date);
            expect(state.encounter.status).toBe('awaiting_review');
            expect(snap).toMatchObject({ orderStatus: 'completed', encounterStatusAfter: 'awaiting_review', encounterBecameAwaitingReview: true });
        });

        // ST-02.4: task bị huỷ không chặn hoàn tất: 1 completed + 1 cancelled -> hoàn tất
        it('ST-02.4: should treat a cancelled task as not blocking completion (completed + cancelled -> awaiting_review)', async () => {
            const { state, service } = makeState('diagnostics_in_progress', ['completed', 'cancelled']);

            const snap = await service.recomputeForTask('task-1');

            expect(state.order.status).toBe('completed');
            expect(state.encounter.status).toBe('awaiting_review');
            expect(snap?.encounterBecameAwaitingReview).toBe(true);
        });

        // ST-02.5: huỷ hết task -> order cancelled, encounter quay về in_progress để bác sĩ chỉ định lại
        it('ST-02.5: should cancel the order and return the encounter to in_progress when every task is cancelled', async () => {
            const { state, service } = makeState('awaiting_diagnostics', ['cancelled', 'cancelled']);
            state.items.forEach((i) => (i.status = 'cancelled'));

            const snap = await service.recomputeForTask('task-1');

            expect(state.order.status).toBe('cancelled');
            expect(state.encounter.status).toBe('in_progress');
            expect(snap).toMatchObject({ orderStatus: 'cancelled', encounterStatusAfter: 'in_progress' });
        });

        // ST-02.6: encounter ngoài tập lab-test quản lý (đã finished) -> không bị đụng
        it("ST-02.6: should never touch an encounter outside the lab-managed statuses (e.g. 'finished')", async () => {
            const { state, service, prisma } = makeState('finished', ['completed']);

            const snap = await service.recomputeForTask('task-1');

            expect(state.encounter.status).toBe('finished');
            expect(prisma.encounter.updateMany).not.toHaveBeenCalled();
            expect(snap).toMatchObject({ encounterStatusBefore: 'finished', encounterStatusAfter: 'finished', encounterBecameAwaitingReview: false });
        });

        // ST-02.7: chỉ định bổ sung khi đang awaiting_review (vòng WF-04 -> WF-03) -> quay lại awaiting_diagnostics
        it('ST-02.7: should send an awaiting_review encounter back to awaiting_diagnostics when an extra task is still ready', async () => {
            const { state, service } = makeState('awaiting_review', ['completed', 'ready']);

            const snap = await service.recomputeForTask('task-1');

            expect(state.encounter.status).toBe('awaiting_diagnostics');
            expect(snap?.encounterBecameAwaitingReview).toBe(false);
        });

        // ST-02.8: task không tồn tại -> null, không ghi gì
        it('ST-02.8: should return null and write nothing when the task does not exist', async () => {
            const { service, prisma } = makeState('awaiting_diagnostics', ['ready']);
            prisma.diagnosticTask.findUnique.mockResolvedValue(null as any);

            await expect(service.recomputeForTask('task-missing')).resolves.toBeNull();

            expect(prisma.diagnosticOrder.update).not.toHaveBeenCalled();
            expect(prisma.encounter.updateMany).not.toHaveBeenCalled();
        });
    });

    // ==============================================================================================================
    describe('ST-03 DiagnosticResult.resultStatus: preliminary -> final / corrected', () => {
        const makeHarness = (existing: { resultStatus: string; taskStatus?: string; modality?: string }) => {
            const tx = { diagnosticResult: { update: jest.fn().mockResolvedValue({}) }, resultValue: { upsert: jest.fn() } };
            const service$ = { serviceId: 'svc-1', modality: existing.modality ?? 'ecg' };
            const prisma = {
                diagnosticResult: {
                    findUnique: jest.fn().mockResolvedValue({
                        resultId: 'res-001',
                        resultStatus: existing.resultStatus,
                        task: { status: existing.taskStatus ?? 'completed', orderItem: { serviceId: 'svc-1', service: service$ } },
                    }),
                    update: jest.fn().mockResolvedValue({}),
                },
                resultParameter: { findMany: jest.fn().mockResolvedValue([]) },
                resultValue: { findMany: jest.fn().mockResolvedValue([]) },
                $transaction: jest.fn(async (cb: any) => cb(tx)),
            };
            const eventEmitter = { emit: jest.fn() };
            const actorRoleService = { assertActorRole: jest.fn().mockResolvedValue(undefined) };
            const service = new LabResultService(prisma as any, {} as any, {} as any, eventEmitter as any, actorRoleService as any);
            jest.spyOn(service, 'getById').mockResolvedValue({ resultId: 'res-001' } as any);
            return { service, prisma, tx, eventEmitter };
        };

        // ST-03.1: preliminary -> final (nhập tay), phát event để detection chạy lại
        it("ST-03.1: should move a 'preliminary' result to 'final' and re-emit the submitted event (no new completion notice)", async () => {
            const h = makeHarness({ resultStatus: 'preliminary' });

            await h.service.updateResult('res-001', { resultStatus: 'final' } as any, 'staff-001');

            expect(h.tx.diagnosticResult.update).toHaveBeenCalledWith({ where: { resultId: 'res-001' }, data: expect.objectContaining({ resultStatus: 'final' }) });
            expect(h.eventEmitter.emit).toHaveBeenCalledWith(LAB_RESULT_SUBMITTED_EVENT, expect.objectContaining({ labResultId: 'res-001', notifyCompletion: false }));
        });

        // ST-03.2: final + sửa nội dung -> corrected (lưu vết đính chính)
        it("ST-03.2: should move a 'final' result to 'corrected' when its content is edited", async () => {
            const h = makeHarness({ resultStatus: 'final' });

            await h.service.updateResult('res-001', { overallConclusion: 'Đính chính kết luận' } as any, 'doc-001');

            expect(h.tx.diagnosticResult.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ resultStatus: 'corrected', overallConclusion: 'Đính chính kết luận' }) }),
            );
        });

        // ST-03.3: preliminary + sửa nội dung -> vẫn preliminary
        it("ST-03.3: should keep a 'preliminary' result 'preliminary' when only its content is edited", async () => {
            const h = makeHarness({ resultStatus: 'preliminary' });

            await h.service.updateResult('res-001', { findings: 'Bổ sung mô tả' } as any, 'staff-001');

            expect(h.tx.diagnosticResult.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ resultStatus: 'preliminary' }) }));
        });

        // ST-03.4: chặn final khi panel máu chưa đủ chỉ số
        it("ST-03.4: should refuse to finalize a blood-test result while the Full panel is incomplete", async () => {
            const h = makeHarness({ resultStatus: 'preliminary', modality: 'blood_test' });
            h.prisma.resultParameter.findMany.mockResolvedValue([
                { parameterId: 'p-hgb', parameterCode: 'HGB' },
                { parameterId: 'p-wbc', parameterCode: 'WBC' },
            ]);
            h.prisma.resultValue.findMany.mockResolvedValue([{ parameterId: 'p-hgb' }]);

            await expect(h.service.updateResult('res-001', { resultStatus: 'final' } as any, 'staff-001')).rejects.toThrow(/WBC/);

            expect(h.prisma.$transaction).not.toHaveBeenCalled();
            expect(h.eventEmitter.emit).not.toHaveBeenCalled();
        });

        // ST-03.5: bác sĩ duyệt + chốt final: ghi reviewedByUserId/reviewedAt (DS-05 expected)
        it("ST-03.5: should record reviewer and time and move the result to 'final' when a doctor reviews with finalize", async () => {
            const h = makeHarness({ resultStatus: 'preliminary' });

            await h.service.reviewResult('res-001', { finalize: true } as any, 'doc-001');

            expect(h.prisma.diagnosticResult.update).toHaveBeenCalledWith({
                where: { resultId: 'res-001' },
                data: expect.objectContaining({ reviewedByUserId: 'doc-001', reviewedAt: expect.any(Date), resultStatus: 'final' }),
            });
        });

        // ST-03.6: kết quả đã 'cancelled' không thể duyệt
        it("ST-03.6: should reject reviewing a 'cancelled' result", async () => {
            const h = makeHarness({ resultStatus: 'cancelled' });

            await expect(h.service.reviewResult('res-001', { finalize: true } as any, 'doc-001')).rejects.toThrow(/đã bị huỷ/);

            expect(h.prisma.diagnosticResult.update).not.toHaveBeenCalled();
        });
    });

    // ==============================================================================================================
    describe('ST-04 ResultValueAlert.status: active -> confirmed -> resolved', () => {
        const ALERT = { alertId: 'alert-001', status: 'active' };
        const makeHarness = () => {
            const prisma = {
                resultValueAlert: {
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                    findUnique: jest.fn().mockResolvedValue(ALERT),
                    findUniqueOrThrow: jest.fn().mockResolvedValue(ALERT),
                },
            };
            const actorRoleService = { assertActorRole: jest.fn().mockResolvedValue(undefined) };
            const service = new LabResultAlertService(prisma as any, actorRoleService as any, {} as any);
            return { service, prisma, actorRoleService };
        };

        // ST-04.1: active -> confirmed
        it("ST-04.1: should move an 'active' alert to 'confirmed' and record who confirmed it", async () => {
            const h = makeHarness();

            await h.service.confirm('alert-001', 'doc-001');

            expect(h.actorRoleService.assertActorRole).toHaveBeenCalledWith('doc-001', [ACTOR_ROLE.DOCTOR, ACTOR_ROLE.LAB_STAFF]);
            expect(h.prisma.resultValueAlert.updateMany).toHaveBeenCalledWith({
                where: { alertId: 'alert-001', status: 'active' },
                data: { status: 'confirmed', confirmedByUserId: 'doc-001', confirmedAt: expect.any(Date) },
            });
        });

        // ST-04.2: confirm khi đã confirmed -> 409 kèm trạng thái hiện tại
        it("ST-04.2: should throw ConflictException when confirming an alert that is already 'confirmed'", async () => {
            const h = makeHarness();
            h.prisma.resultValueAlert.updateMany.mockResolvedValue({ count: 0 });
            h.prisma.resultValueAlert.findUnique.mockResolvedValue({ status: 'confirmed' });

            await expect(h.service.confirm('alert-001', 'doc-001')).rejects.toThrow(ConflictException);
            await expect(h.service.confirm('alert-001', 'doc-001')).rejects.toThrow(/đang ở trạng thái 'confirmed'/);
        });

        // ST-04.3: confirmed -> resolved (cũng cho phép active -> resolved)
        it("ST-04.3: should resolve an alert from 'active' or 'confirmed'", async () => {
            const h = makeHarness();

            await h.service.resolve('alert-001', 'doc-001');

            expect(h.prisma.resultValueAlert.updateMany).toHaveBeenCalledWith({
                where: { alertId: 'alert-001', status: { in: ['active', 'confirmed'] } },
                data: { status: 'resolved' },
            });
        });

        // ST-04.4: resolved là trạng thái cuối - resolve lại bị từ chối
        it("ST-04.4: should reject resolving an alert that is already 'resolved' (terminal state)", async () => {
            const h = makeHarness();
            h.prisma.resultValueAlert.updateMany.mockResolvedValue({ count: 0 });
            h.prisma.resultValueAlert.findUnique.mockResolvedValue({ status: 'resolved' });

            await expect(h.service.resolve('alert-001', 'doc-001')).rejects.toThrow(/đang ở trạng thái 'resolved'/);
        });

        // ST-04.5: cảnh báo không tồn tại -> 404
        it('ST-04.5: should throw NotFoundException when the alert does not exist', async () => {
            const h = makeHarness();
            h.prisma.resultValueAlert.updateMany.mockResolvedValue({ count: 0 });
            h.prisma.resultValueAlert.findUnique.mockResolvedValue(null);

            await expect(h.service.confirm('alert-missing', 'doc-001')).rejects.toThrow(NotFoundException);
        });

        // ST-04.6: RBAC - vai trò không hợp lệ bị chặn trước khi đổi trạng thái
        it('ST-04.6: should block a caller without DOCTOR/LAB_STAFF role before changing any state', async () => {
            const h = makeHarness();
            h.actorRoleService.assertActorRole.mockRejectedValue(new ForbiddenException('Không đủ quyền'));

            await expect(h.service.confirm('alert-001', 'user-patient')).rejects.toThrow(ForbiddenException);

            expect(h.prisma.resultValueAlert.updateMany).not.toHaveBeenCalled();
        });
    });

    // ==============================================================================================================
    describe('ST-05 EcgRecording: completed -> cancelled', () => {
        const makeHarness = (recording: any, cancelledCount = 1) => {
            const tx = {
                ecgRecording: { updateMany: jest.fn().mockResolvedValue({ count: cancelledCount }) },
                ecgAiAnalysis: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            };
            const prisma = {
                ecgRecording: { findUnique: jest.fn().mockResolvedValue(recording) },
                $transaction: jest.fn(async (cb: any) => cb(tx)),
            };
            const service = new EcgRecordingService(prisma as any, { assertActorRole: jest.fn().mockResolvedValue(undefined) } as any, { emit: jest.fn() } as any, {} as any);
            jest.spyOn(service, 'getById').mockResolvedValue({ ecgRecordingId: 'rec-001', status: 'cancelled' } as any);
            return { service, prisma, tx };
        };
        const rec = (taskStatus: string, assigned: string | null = 'staff-001') => ({ ecgRecordingId: 'rec-001', task: { status: taskStatus, assignedStaffUserId: assigned } });

        // ST-05.1: huỷ bản ghi tải nhầm khi task in_progress -> cancelled + bỏ isCurrent của các analysis
        it("ST-05.1: should cancel a mistaken recording while the task is in_progress and drop isCurrent of its analyses", async () => {
            const h = makeHarness(rec('in_progress'));

            await h.service.cancel('rec-001', 'staff-001');

            expect(h.tx.ecgRecording.updateMany).toHaveBeenCalledWith({ where: { ecgRecordingId: 'rec-001', status: { not: 'cancelled' } }, data: { status: 'cancelled' } });
            expect(h.tx.ecgAiAnalysis.updateMany).toHaveBeenCalledWith({ where: { ecgRecordingId: 'rec-001' }, data: { isCurrent: false } });
        });

        // ST-05.2: task đã completed -> không được huỷ
        it("ST-05.2: should refuse to cancel once the task is 'completed'", async () => {
            const h = makeHarness(rec('completed'));

            await expect(h.service.cancel('rec-001', 'staff-001')).rejects.toThrow(/Chỉ huỷ được khi nhiệm vụ đang 'in_progress'/);

            expect(h.prisma.$transaction).not.toHaveBeenCalled();
        });

        // ST-05.3: đã cancelled -> huỷ lần 2 bị từ chối, không đụng analysis
        it('ST-05.3: should refuse to cancel a recording that is already cancelled', async () => {
            const h = makeHarness(rec('in_progress'), 0);

            await expect(h.service.cancel('rec-001', 'staff-001')).rejects.toThrow(/đã được huỷ trước đó/);

            expect(h.tx.ecgAiAnalysis.updateMany).not.toHaveBeenCalled();
        });
    });

    // ==============================================================================================================
    describe('ST-06 EcgAnomalyEvent.alertStatus: active -> acknowledged -> resolved', () => {
        const makeHarness = () => {
            const prisma = {
                ecgAnomalyEvent: {
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                    findUnique: jest.fn().mockResolvedValue({ alertStatus: 'active' }),
                },
            };
            const actorRoleService = { assertActorRole: jest.fn().mockResolvedValue(undefined) };
            const service = new EcgAnomalyEventService(prisma as any, actorRoleService as any);
            jest.spyOn(service, 'getById').mockResolvedValue({ eventId: 'ev-001' } as any);
            return { service, prisma, actorRoleService };
        };

        // ST-06.1: bác sĩ xác nhận đã nhận cảnh báo AI (DS-05 expected)
        it("ST-06.1: should move an 'active' ECG anomaly alert to 'acknowledged' and record the doctor", async () => {
            const h = makeHarness();

            await h.service.acknowledge('ev-001', 'doc-001');

            expect(h.prisma.ecgAnomalyEvent.updateMany).toHaveBeenCalledWith({
                where: { eventId: 'ev-001', alertStatus: 'active' },
                data: { alertStatus: 'acknowledged', acknowledgedByUserId: 'doc-001', acknowledgedAt: expect.any(Date) },
            });
        });

        // ST-06.2: acknowledge lần 2 -> 409
        it("ST-06.2: should throw ConflictException when acknowledging an alert that is no longer 'active'", async () => {
            const h = makeHarness();
            h.prisma.ecgAnomalyEvent.updateMany.mockResolvedValue({ count: 0 });
            h.prisma.ecgAnomalyEvent.findUnique.mockResolvedValue({ alertStatus: 'acknowledged' });

            await expect(h.service.acknowledge('ev-001', 'doc-001')).rejects.toThrow(/đang ở trạng thái 'acknowledged'/);
        });

        // ST-06.3: acknowledged -> resolved
        it("ST-06.3: should resolve an alert from 'active' or 'acknowledged'", async () => {
            const h = makeHarness();

            await h.service.resolve('ev-001', 'doc-001');

            expect(h.prisma.ecgAnomalyEvent.updateMany).toHaveBeenCalledWith({
                where: { eventId: 'ev-001', alertStatus: { in: ['active', 'acknowledged'] } },
                data: { alertStatus: 'resolved' },
            });
        });
    });
});
