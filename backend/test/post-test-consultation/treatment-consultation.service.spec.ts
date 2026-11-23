import { BadRequestException, ConflictException } from '@nestjs/common';
import { TreatmentConsultationService } from '../../src/modules/clinical/post-test-consultation/treatment-consultation/treatment-consultation.service';
import { EncounterStatus } from '../../src/common/utils/encounter-status.util';
import { AppointmentStatus } from '../../src/common/utils/appointment-status.util';

describe('TreatmentConsultationService - F-12 & F-14 Follow-up Scheduling', () => {
    let service: TreatmentConsultationService;
    let mockPrisma: any;
    let mockActorRoleService: any;
    let mockDoctorService: any;
    let mockTx: any;

    const currentUserId = 'user-doc-01';
    const doctor = { doctorId: 'doc-01' };
    const encounterId = 'enc-01';
    const futureSlotTime = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    const makeSlot = (over: Record<string, any> = {}) => ({
        slotId: 'slot-01',
        status: 'free',
        capacity: 2,
        bookedCount: 0,
        slotStartTime: futureSlotTime,
        schedule: { doctorId: doctor.doctorId, status: 'active' },
        ...over,
    });

    beforeEach(() => {
        mockTx = {
            appointment: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ appointmentId: 'apt-fu-01' }),
                update: jest.fn().mockResolvedValue({ appointmentId: 'apt-fu-01' }),
            },
            appointmentSlot: {
                findUnique: jest.fn().mockResolvedValue(makeSlot()),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                update: jest.fn().mockResolvedValue({}),
            },
            treatmentConsultation: {
                upsert: jest.fn().mockImplementation(async ({ create }: any) => ({
                    consultationId: 'cons-01',
                    ...create,
                })),
            },
        };

        mockPrisma = {
            encounter: {
                findUnique: jest.fn().mockResolvedValue({
                    encounterId,
                    patientId: 'pat-01',
                    doctorId: doctor.doctorId,
                    status: EncounterStatus.AWAITING_REVIEW,
                }),
            },
            treatmentConsultation: {
                findUnique: jest.fn().mockResolvedValue(null),
            },
            diagnosis: {
                count: jest.fn().mockResolvedValue(1),
            },
            appointment: {
                findUnique: jest.fn().mockResolvedValue(null),
            },
            $transaction: jest.fn((cb: (tx: any) => Promise<unknown>) => cb(mockTx)),
        };

        mockActorRoleService = { assertActorRole: jest.fn().mockResolvedValue(undefined) };
        mockDoctorService = { findByUserId: jest.fn().mockResolvedValue(doctor) };

        service = new TreatmentConsultationService(mockPrisma, mockActorRoleService, mockDoctorService);
    });

    it('F-14 [Normal]: should create consultation and reserve follow-up appointment when followUpRequired = true', async () => {
        const dto: any = {
            conditionExplanation: 'Đau thắt ngực ổn định',
            treatmentPlan: 'Dùng thuốc theo đơn, tái khám sau 14 ngày',
            followUpRequired: true,
            followUpSlotId: 'slot-01',
            followUpIntervalDays: 14,
        };

        const result = await service.upsert(encounterId, dto, currentUserId);

        expect(mockTx.appointmentSlot.updateMany).toHaveBeenCalledWith({
            where: { slotId: 'slot-01', bookedCount: { lt: 2 } },
            data: { bookedCount: { increment: 1 } },
        });
        expect(mockTx.appointment.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    patientId: 'pat-01',
                    doctorId: doctor.doctorId,
                    slotId: 'slot-01',
                    bookingChannel: 'doctor_follow_up',
                    appointmentType: 'follow_up',
                    sourceEncounterId: encounterId,
                    status: AppointmentStatus.PENDING,
                }),
            }),
        );
        expect(result.followUpRequired).toBe(true);
    });

    it('F-12 [Normal]: should create consultation without follow-up appointment when followUpRequired = false', async () => {
        const dto: any = {
            conditionExplanation: 'Tình trạng ổn định',
            treatmentPlan: 'Tiếp tục theo dõi tại nhà',
            followUpRequired: false,
        };

        const result = await service.upsert(encounterId, dto, currentUserId);

        expect(mockTx.appointment.create).not.toHaveBeenCalled();
        expect(result.followUpRequired).toBe(false);
    });

    it('F-12 [Abnormal]: should throw BadRequestException if no final diagnosis exists when creating consultation for the first time', async () => {
        mockPrisma.diagnosis.count.mockResolvedValue(0);

        await expect(
            service.upsert(encounterId, { treatmentPlan: 'Test', followUpRequired: false } as any, currentUserId),
        ).rejects.toThrow(BadRequestException);
        expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('F-14 [Abnormal]: should throw BadRequestException when followUpRequired = true without followUpSlotId', async () => {
        await expect(
            service.upsert(encounterId, { treatmentPlan: 'Test', followUpRequired: true } as any, currentUserId),
        ).rejects.toThrow(BadRequestException);
    });

    it('F-14 [Abnormal]: should throw BadRequestException when followUpSlotId is in the past', async () => {
        mockTx.appointmentSlot.findUnique.mockResolvedValue(
            makeSlot({ slotStartTime: new Date('2000-01-01T08:00:00.000Z') }),
        );

        await expect(
            service.upsert(
                encounterId,
                { treatmentPlan: 'Test', followUpRequired: true, followUpSlotId: 'slot-01' } as any,
                currentUserId,
            ),
        ).rejects.toThrow(BadRequestException);
    });

    it('F-14 [Abnormal]: should throw ConflictException when target follow-up slot is concurrently filled', async () => {
        mockTx.appointmentSlot.updateMany.mockResolvedValue({ count: 0 });

        await expect(
            service.upsert(
                encounterId,
                { treatmentPlan: 'Test', followUpRequired: true, followUpSlotId: 'slot-01' } as any,
                currentUserId,
            ),
        ).rejects.toThrow(ConflictException);
    });

    it('F-14 [Boundary]: should reject disabling followUpRequired when an active follow-up appointment already exists', async () => {
        mockTx.appointment.findUnique.mockResolvedValue({
            appointmentId: 'apt-fu-01',
            slotId: 'slot-01',
            status: AppointmentStatus.CONFIRMED,
        });

        await expect(
            service.upsert(encounterId, { treatmentPlan: 'Test', followUpRequired: false } as any, currentUserId),
        ).rejects.toThrow(BadRequestException);
    });
});
