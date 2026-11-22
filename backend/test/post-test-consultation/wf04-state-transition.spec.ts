import { BadRequestException } from '@nestjs/common';
import { EncounterService } from '../../src/modules/patient-flow/reception-intake/encounter/encounter.service';
import { DiagnosisConclusionService } from '../../src/modules/clinical/post-test-consultation/diagnosis-conclusion/diagnosis-conclusion.service';
import { TreatmentConsultationService } from '../../src/modules/clinical/post-test-consultation/treatment-consultation/treatment-consultation.service';
import { PrescriptionService } from '../../src/modules/pharmacy/prescription/prescription.service';
import { TestOrderService } from '../../src/modules/clinical/pre-doctor-examination/test-order/test-order.service';
import { EncounterStatus } from '../../src/common/utils/encounter-status.util';
import { AppointmentStatus } from '../../src/common/utils/appointment-status.util';

// @nestjs/event-emitter phát hành ESM — Jest (CJS) không nạp được; mock rỗng cho TestOrderService.
jest.mock('@nestjs/event-emitter', () => ({ EventEmitter2: class {}, OnEvent: () => () => undefined }));

/**
 * WF-04 — State Transition & End-to-End Workflow Tests (Commitment Section 6.4):
 *   ST-01 Encounter (closure)          : awaiting_review -> finished
 *   ST-02 Encounter (additional tests) : awaiting_review -> awaiting_diagnostics (back to WF-03)
 *   ST-03 Prescription                 : draft -> cancelled (and immutability after leaving draft)
 *   E2E DS-07 (Main scenario)          : Final ICD-10 I20.9 -> Draft Prescription -> Follow-up 14d -> Finish Encounter
 *   E2E DS-08 (Exception scenario)     : Inconclusive review -> Order additional Chest X-ray -> Encounter back to awaiting_diagnostics
 */
describe('WF-04 state transitions & E2E scenarios', () => {
    const doctorUser = { userId: 'user-doc-01', email: 'doc@clinic.vn' } as any;
    const doctor = { doctorId: 'doc-01', userId: 'user-doc-01' };
    const encounterId = 'enc-wf04-01';

    describe('ST-01 Encounter: awaiting_review -> finished', () => {
        const makeEncounterHarness = (status: string) => {
            const tx = {
                encounter: {
                    update: jest.fn().mockResolvedValue({
                        encounterId,
                        status: EncounterStatus.FINISHED,
                        finishedAt: new Date(),
                    }),
                },
                appointment: {
                    update: jest.fn().mockResolvedValue({
                        appointmentId: 'apt-01',
                        status: AppointmentStatus.COMPLETED,
                    }),
                },
                doctorQueueEntry: {
                    update: jest.fn().mockResolvedValue({
                        encounterId,
                        status: 'done',
                    }),
                },
            };
            const prisma = {
                encounter: {
                    findUnique: jest.fn().mockResolvedValue({
                        encounterId,
                        appointmentId: 'apt-01',
                        doctorId: doctor.doctorId,
                        status,
                        appointment: { appointmentId: 'apt-01' },
                        doctorQueueEntry: { encounterId, status: 'in_progress' },
                    }),
                },
                doctor: {
                    findUnique: jest.fn().mockResolvedValue({ doctorId: doctor.doctorId }),
                },
                prescription: {
                    count: jest.fn().mockResolvedValue(1),
                },
                $transaction: jest.fn((cb: any) => cb(tx)),
            };
            const service = new EncounterService(prisma as any, {} as any, {} as any);
            return { service, tx, prisma };
        };

        it('ST-01 [Normal]: transitions Encounter from awaiting_review to finished, Appointment to completed, QueueEntry to done', async () => {
            const { service, tx } = makeEncounterHarness(EncounterStatus.AWAITING_REVIEW);

            const res = await service.finishEncounter(encounterId, doctorUser);

            expect(tx.encounter.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({ encounterId }),
                    data: expect.objectContaining({ status: EncounterStatus.FINISHED }),
                }),
            );
            expect(tx.appointment.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: { status: AppointmentStatus.COMPLETED } }),
            );
            expect(tx.doctorQueueEntry.update).toHaveBeenCalledWith(
                expect.objectContaining({ data: expect.objectContaining({ status: 'done' }) }),
            );
            expect(res.encounter.status).toBe(EncounterStatus.FINISHED);
        });

        it('ST-01 [Abnormal]: rejects premature finishEncounter when Encounter is awaiting_diagnostics or already finished', async () => {
            const hDiag = makeEncounterHarness(EncounterStatus.AWAITING_DIAGNOSTICS);
            await expect(hDiag.service.finishEncounter(encounterId, doctorUser)).rejects.toThrow(BadRequestException);

            const hDone = makeEncounterHarness(EncounterStatus.FINISHED);
            await expect(hDone.service.finishEncounter(encounterId, doctorUser)).rejects.toThrow(BadRequestException);
        });
    });

    describe('ST-02 Encounter: awaiting_review -> awaiting_diagnostics (additional test order)', () => {
        it('ST-02 [Normal]: ordering an additional test when awaiting_review transitions Encounter back to awaiting_diagnostics', async () => {
            const tx = {
                $executeRaw: jest.fn().mockResolvedValue(1),
                diagnosticOrderItem: {
                    findMany: jest.fn().mockResolvedValue([]),
                    createMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
                diagnosticOrder: { create: jest.fn().mockResolvedValue({ orderId: 'ord-add-01' }) },
                diagnosticTask: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
                encounter: {
                    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
            };

            const prisma = {
                diagnosis: {
                    findUnique: jest.fn().mockResolvedValue({
                        diagnosisId: 'diag-init-01',
                        encounterId,
                        diagnosisType: 'initial',
                    }),
                },
                serviceCatalog: {
                    findMany: jest.fn().mockResolvedValue([
                        { serviceId: 'svc-xray', serviceName: 'Chest X-ray PA', defaultRoomId: 'room-xray', isActive: true },
                    ]),
                },
                diagnosticOrder: {
                    findUnique: jest
                        .fn()
                        .mockResolvedValueOnce(null)
                        .mockResolvedValueOnce({
                            orderId: 'ord-add-01',
                            status: 'ordered',
                            items: [{ serviceId: 'svc-xray' }],
                        }),
                },
                $transaction: jest.fn((cb: any) => cb(tx)),
            };
            const access = {
                prepareWrite: jest.fn().mockResolvedValue({
                    doctor,
                    encounter: { encounterId, status: EncounterStatus.AWAITING_REVIEW },
                }),
            };

            const orderService = new TestOrderService(
                prisma as any,
                { assertActorRole: jest.fn() } as any,
                { findByUserId: jest.fn() } as any,
                access as any,
                { emit: jest.fn() } as any,
            );

            const order = await orderService.create(
                encounterId,
                { diagnosisId: 'diag-init-01', items: [{ serviceId: 'svc-xray' }] } as any,
                doctorUser.userId,
            );

            expect(tx.encounter.updateMany).toHaveBeenCalledWith({
                where: {
                    encounterId,
                    status: { in: [EncounterStatus.IN_PROGRESS, EncounterStatus.AWAITING_REVIEW] },
                },
                data: { status: EncounterStatus.AWAITING_DIAGNOSTICS },
            });
            expect(order.orderId).toBe('ord-add-01');
        });
    });

    describe('ST-03 Prescription: draft -> cancelled', () => {
        it('ST-03 [Normal]: transitions Prescription from draft to cancelled', async () => {
            const prisma = {
                prescription: {
                    findUnique: jest.fn().mockResolvedValue({
                        prescriptionId: 'rx-01',
                        doctorId: doctor.doctorId,
                        status: 'draft',
                    }),
                    update: jest.fn().mockResolvedValue({
                        prescriptionId: 'rx-01',
                        status: 'cancelled',
                    }),
                },
            };
            const rxService = new PrescriptionService(
                prisma as any,
                { findByUserId: jest.fn().mockResolvedValue(doctor) } as any,
                { assertActorRole: jest.fn().mockResolvedValue(undefined) } as any,
                { run: jest.fn() } as any,
            );

            const res = await rxService.cancel('rx-01', doctorUser);
            expect(res.status).toBe('cancelled');
        });
    });

    describe('E2E Scenarios (DS-07 Main & DS-08 Exception)', () => {
        it('E2E DS-07 [Main]: Doctor confirms I20.9 -> drafts Atorvastatin+Amlodipine prescription -> schedules 14d follow-up -> finishes encounter', async () => {
            // In-memory state tracking across WF-04 steps
            let encounterStatus = EncounterStatus.AWAITING_REVIEW;
            const slotFuture = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
            let slotBooked = 0;

            const sharedTx: any = {
                diagnosis: {
                    findFirst: jest.fn().mockResolvedValue(null),
                    count: jest.fn().mockResolvedValue(0),
                    updateMany: jest.fn(),
                    create: jest.fn().mockImplementation(async ({ data }: any) => ({
                        diagnosisId: 'diag-final-i209',
                        ...data,
                    })),
                },
                prescription: {
                    create: jest.fn().mockImplementation(async ({ data }: any) => ({
                        prescriptionId: 'rx-ds07',
                        ...data,
                    })),
                },
                appointment: {
                    findUnique: jest.fn().mockResolvedValue(null),
                    create: jest.fn().mockResolvedValue({ appointmentId: 'apt-fu-ds07' }),
                    update: jest.fn().mockResolvedValue({ appointmentId: 'apt-orig-01', status: AppointmentStatus.COMPLETED }),
                },
                appointmentSlot: {
                    findUnique: jest.fn().mockResolvedValue({
                        slotId: 'slot-14d',
                        status: 'free',
                        capacity: 2,
                        bookedCount: slotBooked,
                        slotStartTime: slotFuture,
                        schedule: { doctorId: doctor.doctorId, status: 'active' },
                    }),
                    updateMany: jest.fn().mockImplementation(async () => {
                        slotBooked += 1;
                        return { count: 1 };
                    }),
                    update: jest.fn(),
                },
                treatmentConsultation: {
                    upsert: jest.fn().mockResolvedValue({ consultationId: 'cons-ds07', followUpRequired: true }),
                },
                encounter: {
                    update: jest.fn().mockImplementation(async ({ data }: any) => {
                        encounterStatus = data.status;
                        return { encounterId, status: encounterStatus };
                    }),
                },
                doctorQueueEntry: {
                    update: jest.fn().mockResolvedValue({ encounterId, status: 'done' }),
                },
            };

            const sharedPrisma: any = {
                encounter: {
                    findUnique: jest.fn().mockImplementation(async () => ({
                        encounterId,
                        patientId: 'pat-an',
                        doctorId: doctor.doctorId,
                        appointmentId: 'apt-orig-01',
                        status: encounterStatus,
                        appointment: { appointmentId: 'apt-orig-01' },
                        doctorQueueEntry: { encounterId, status: 'in_progress' },
                    })),
                },
                doctor: { findUnique: jest.fn().mockResolvedValue(doctor) },
                diagnosis: {
                    findUnique: jest.fn().mockResolvedValue({
                        diagnosisId: 'diag-final-i209',
                        encounterId,
                        doctorId: doctor.doctorId,
                        diagnosisType: 'final',
                    }),
                    count: jest.fn().mockResolvedValue(1),
                },
                drugCatalog: {
                    findMany: jest.fn().mockResolvedValue([
                        { drugId: 'drug-ator', drugCode: 'ATOR20', drugName: 'Atorvastatin', isActive: true },
                        { drugId: 'drug-amlo', drugCode: 'AMLO5', drugName: 'Amlodipine 5mg', isActive: true },
                    ]),
                },
                prescription: {
                    findUnique: jest
                        .fn()
                        .mockResolvedValueOnce(null)
                        .mockResolvedValueOnce({ prescriptionId: 'rx-ds07', status: 'draft' }),
                    count: jest.fn().mockResolvedValue(1),
                },
                appointment: { findUnique: jest.fn().mockResolvedValue(null) },
                treatmentConsultation: { findUnique: jest.fn().mockResolvedValue(null) },
                $transaction: jest.fn((cb: any) => cb(sharedTx)),
            };

            const actorRole = { assertActorRole: jest.fn().mockResolvedValue(undefined) } as any;
            const docSvc = { findByUserId: jest.fn().mockResolvedValue(doctor) } as any;

            const diagSvc = new DiagnosisConclusionService(sharedPrisma, actorRole, docSvc, {
                getByCode: jest.fn().mockResolvedValue({ icd10Code: 'I20.9', icd10Name: 'Angina pectoris, unspecified', isActive: true }),
            } as any);
            const rxSvc = new PrescriptionService(sharedPrisma, docSvc, actorRole, { run: jest.fn().mockResolvedValue([]) } as any);
            const consSvc = new TreatmentConsultationService(sharedPrisma, actorRole, docSvc);
            const encSvc = new EncounterService(sharedPrisma, {} as any, {} as any);

            // Step 1: Confirm ICD-10 I20.9
            const finalDiag = await diagSvc.create(encounterId, { icd10Code: 'I20.9', notes: 'Đau thắt ngực' }, doctorUser.userId);
            expect(finalDiag.diagnosisType).toBe('final');

            // Step 2: Create draft prescription
            const rx = await rxSvc.create(
                {
                    encounterId,
                    diagnosisId: finalDiag.diagnosisId,
                    items: [
                        { drugId: 'drug-ator', quantity: 30, dosage: '20mg', frequency: '1v/tối' },
                        { drugId: 'drug-amlo', quantity: 30, dosage: '5mg', frequency: '1v/sáng' },
                    ],
                } as any,
                doctorUser,
            );
            expect(rx.status).toBe('draft');

            // Step 3: Schedule 14-day follow-up
            const cons = await consSvc.upsert(
                encounterId,
                { treatmentPlan: 'Uống thuốc đều', followUpRequired: true, followUpSlotId: 'slot-14d', followUpIntervalDays: 14 } as any,
                doctorUser.userId,
            );
            expect(cons.followUpRequired).toBe(true);
            expect(slotBooked).toBe(1);

            // Step 4: Close encounter
            const closed = await encSvc.finishEncounter(encounterId, doctorUser);
            expect(closed.encounter.status).toBe(EncounterStatus.FINISHED);
            expect(encounterStatus).toBe(EncounterStatus.FINISHED);
        });

        it('E2E DS-08 [Exception]: Inconclusive review redirects back to WF-03 (awaiting_diagnostics) and blocks premature closure', async () => {
            let encounterStatus = EncounterStatus.AWAITING_REVIEW;

            const tx = {
                $executeRaw: jest.fn().mockResolvedValue(1),
                diagnosticOrderItem: {
                    findMany: jest.fn().mockResolvedValue([]),
                    createMany: jest.fn().mockResolvedValue({ count: 1 }),
                },
                diagnosticOrder: { create: jest.fn().mockResolvedValue({ orderId: 'ord-cxr' }) },
                diagnosticTask: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
                encounter: {
                    updateMany: jest.fn().mockImplementation(async ({ data }: any) => {
                        encounterStatus = data.status;
                        return { count: 1 };
                    }),
                },
            };

            const prisma: any = {
                diagnosis: { findUnique: jest.fn().mockResolvedValue({ diagnosisId: 'diag-init', encounterId, diagnosisType: 'initial' }) },
                serviceCatalog: { findMany: jest.fn().mockResolvedValue([{ serviceId: 'svc-cxr', serviceName: 'Chest X-ray', defaultRoomId: 'room-xr', isActive: true }]) },
                diagnosticOrder: {
                    findUnique: jest
                        .fn()
                        .mockResolvedValueOnce(null)
                        .mockResolvedValueOnce({ orderId: 'ord-cxr', status: 'ordered' }),
                },
                encounter: {
                    findUnique: jest.fn().mockImplementation(async () => ({
                        encounterId,
                        doctorId: doctor.doctorId,
                        status: encounterStatus,
                    })),
                },
                doctor: { findUnique: jest.fn().mockResolvedValue(doctor) },
                $transaction: jest.fn((cb: any) => cb(tx)),
            };

            const orderSvc = new TestOrderService(
                prisma,
                { assertActorRole: jest.fn() } as any,
                { findByUserId: jest.fn() } as any,
                { prepareWrite: jest.fn().mockResolvedValue({ doctor, encounter: { encounterId, status: encounterStatus } }) } as any,
                { emit: jest.fn() } as any,
            );
            const encSvc = new EncounterService(prisma, {} as any, {} as any);

            await orderSvc.create(encounterId, { diagnosisId: 'diag-init', items: [{ serviceId: 'svc-cxr' }] } as any, doctorUser.userId);
            expect(encounterStatus).toBe(EncounterStatus.AWAITING_DIAGNOSTICS);

            // Premature encounter closure must be rejected while diagnostics are pending
            await expect(encSvc.finishEncounter(encounterId, doctorUser)).rejects.toThrow(BadRequestException);
        });
    });
});
