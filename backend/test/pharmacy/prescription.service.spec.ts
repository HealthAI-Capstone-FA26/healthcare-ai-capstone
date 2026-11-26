import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrescriptionService } from '../../src/modules/pharmacy/prescription/prescription.service';
import { AllergyContraindicationDetector } from '../../src/modules/pharmacy/prescription/prescription-safety/detectors/allergy-contraindication.detector';
import { DuplicateTherapeuticClassDetector } from '../../src/modules/pharmacy/prescription/prescription-safety/detectors/duplicate-therapeutic-class.detector';
import { EncounterStatus } from '../../src/common/utils/encounter-status.util';
import { ACTOR_ROLE } from '../../src/common/constants/actor-role.constant';

describe('PrescriptionService - Function 20: create & F-13 Safety Checks', () => {
    let service: PrescriptionService;
    let mockPrisma: any;
    let mockDoctorService: any;
    let mockActorRoleService: any;
    let mockSafetyOrchestrator: any;
    let mockTx: any;

    const currentUser = { userId: 'user-doc-01', email: 'doc@clinic.vn', roles: [ACTOR_ROLE.DOCTOR] } as any;
    const doctor = { doctorId: 'doc-01', userId: 'user-doc-01', fullName: 'BS. Nguyễn Văn Tim' };
    const encounterId = 'enc-01';
    const diagnosisId = 'diag-final-01';

    const baseDto = {
        encounterId,
        diagnosisId,
        items: [
            {
                drugId: 'drug-atorvastatin',
                quantity: 30,
                dosage: '20mg',
                routeCode: 'PO',
                frequency: '1 viên/tối',
                durationDays: 30,
                instruction: 'Uống sau ăn tối',
            },
            {
                drugId: 'drug-amlodipine',
                quantity: 30,
                dosage: '5mg',
                routeCode: 'PO',
                frequency: '1 viên/sáng',
                durationDays: 30,
                instruction: 'Uống buổi sáng',
            },
        ],
    };

    const activeDrugs = [
        { drugId: 'drug-atorvastatin', drugCode: 'ATOR20', drugName: 'Atorvastatin 20mg', isActive: true },
        { drugId: 'drug-amlodipine', drugCode: 'AMLO5', drugName: 'Amlodipine 5mg', isActive: true },
    ];

    beforeEach(() => {
        mockTx = {
            prescription: {
                create: jest.fn(),
                update: jest.fn(),
            },
            prescriptionItem: {
                deleteMany: jest.fn(),
            },
        };

        mockPrisma = {
            diagnosis: {
                findUnique: jest.fn().mockResolvedValue({
                    diagnosisId,
                    encounterId,
                    doctorId: doctor.doctorId,
                    diagnosisType: 'final',
                }),
            },
            encounter: {
                findUnique: jest.fn().mockResolvedValue({
                    encounterId,
                    doctorId: doctor.doctorId,
                    status: EncounterStatus.AWAITING_REVIEW,
                }),
            },
            drugCatalog: {
                findMany: jest.fn().mockResolvedValue(activeDrugs),
            },
            prescription: {
                findUnique: jest.fn(),
                update: jest.fn(),
                findMany: jest.fn(),
            },
            $transaction: jest.fn((cb: (tx: any) => Promise<unknown>) => cb(mockTx)),
        };

        mockDoctorService = {
            findByUserId: jest.fn().mockResolvedValue(doctor),
        };

        mockActorRoleService = {
            assertActorRole: jest.fn().mockResolvedValue(undefined),
        };

        mockSafetyOrchestrator = {
            run: jest.fn().mockResolvedValue([]),
        };

        service = new PrescriptionService(
            mockPrisma,
            mockDoctorService,
            mockActorRoleService,
            mockSafetyOrchestrator,
        );
    });

    // TC-F20-01 [Normal]
    it('TC-F20-01 [Normal]: should create draft prescription and trigger safety check when diagnosis is final and encounter is awaiting_review', async () => {
        const created = {
            prescriptionId: 'rx-01',
            prescriptionCode: 'DT000001',
            encounterId,
            diagnosisId,
            doctorId: doctor.doctorId,
            status: 'draft',
            items: baseDto.items,
            safetyAlerts: [],
        };

        mockTx.prescription.create.mockResolvedValue(created);
        mockPrisma.prescription.findUnique
            .mockResolvedValueOnce(null) // generatePrescriptionCode uniqueness check
            .mockResolvedValueOnce(created); // final findById

        const result = await service.create(baseDto as any, currentUser);

        expect(mockActorRoleService.assertActorRole).toHaveBeenCalledWith(currentUser.userId, [ACTOR_ROLE.DOCTOR]);
        expect(mockTx.prescription.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    encounterId,
                    diagnosisId,
                    doctorId: doctor.doctorId,
                    status: 'draft',
                }),
            }),
        );
        expect(mockSafetyOrchestrator.run).toHaveBeenCalledWith('rx-01');
        expect(result.status).toBe('draft');
    });

    // TC-F20-02 [Abnormal]
    it('TC-F20-02 [Abnormal]: should throw NotFoundException when diagnosisId does not exist', async () => {
        mockPrisma.diagnosis.findUnique.mockResolvedValue(null);

        await expect(service.create(baseDto as any, currentUser)).rejects.toThrow(NotFoundException);
        expect(mockSafetyOrchestrator.run).not.toHaveBeenCalled();
    });

    // TC-F20-03 [Abnormal]
    it('TC-F20-03 [Abnormal]: should throw ForbiddenException when diagnosis belongs to another doctor', async () => {
        mockPrisma.diagnosis.findUnique.mockResolvedValue({
            diagnosisId,
            encounterId,
            doctorId: 'doc-other',
            diagnosisType: 'final',
        });

        await expect(service.create(baseDto as any, currentUser)).rejects.toThrow(ForbiddenException);
        expect(mockTx.prescription.create).not.toHaveBeenCalled();
    });

    // TC-F20-04 [Abnormal]
    it('TC-F20-04 [Abnormal]: should throw ForbiddenException when encounter status is not awaiting_review', async () => {
        mockPrisma.encounter.findUnique.mockResolvedValue({
            encounterId,
            doctorId: doctor.doctorId,
            status: EncounterStatus.AWAITING_DIAGNOSTICS,
        });

        await expect(service.create(baseDto as any, currentUser)).rejects.toThrow(ForbiddenException);
        expect(mockTx.prescription.create).not.toHaveBeenCalled();
    });

    // TC-F20-05 [Abnormal]
    it('TC-F20-05 [Abnormal]: should throw BadRequestException when prescription contains an inactive drug', async () => {
        mockPrisma.drugCatalog.findMany.mockResolvedValue([
            { drugId: 'drug-atorvastatin', drugCode: 'ATOR20', drugName: 'Atorvastatin 20mg', isActive: false },
            { drugId: 'drug-amlodipine', drugCode: 'AMLO5', drugName: 'Amlodipine 5mg', isActive: true },
        ]);

        await expect(service.create(baseDto as any, currentUser)).rejects.toThrow(BadRequestException);
        expect(mockTx.prescription.create).not.toHaveBeenCalled();
    });

    // TC-F20-06 [Boundary] - prescribing directly on an initial diagnosis (Encounter in_progress)
    it('TC-F20-06 [Boundary]: should create draft prescription and run safety check when prescribing directly on an initial diagnosis', async () => {
        const created = {
            prescriptionId: 'rx-06',
            prescriptionCode: 'DT000006',
            encounterId,
            diagnosisId,
            doctorId: doctor.doctorId,
            status: 'draft',
            items: baseDto.items,
            safetyAlerts: [],
        };

        mockPrisma.diagnosis.findUnique.mockResolvedValue({
            diagnosisId,
            encounterId,
            doctorId: doctor.doctorId,
            diagnosisType: 'initial',
        });
        mockPrisma.encounter.findUnique.mockResolvedValue({
            encounterId,
            doctorId: doctor.doctorId,
            status: EncounterStatus.IN_PROGRESS,
        });
        mockTx.prescription.create.mockResolvedValue(created);
        mockPrisma.prescription.findUnique
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(created);

        const result = await service.create(baseDto as any, currentUser);

        expect(mockTx.prescription.create).toHaveBeenCalled();
        expect(mockSafetyOrchestrator.run).toHaveBeenCalledWith('rx-06');
        expect(result.status).toBe('draft');
    });

    // Additional Feature Tests for F-13 (updateItems, cancel, safety detectors)
    it('F-13 [Normal]: updateItems should replace items on draft prescription and re-run safety check', async () => {
        const draftRx = { prescriptionId: 'rx-01', doctorId: doctor.doctorId, status: 'draft' };
        const updatedRx = { ...draftRx, items: [baseDto.items[0]] };

        mockPrisma.prescription.findUnique
            .mockResolvedValueOnce(draftRx)
            .mockResolvedValueOnce(updatedRx);
        mockPrisma.drugCatalog.findMany.mockResolvedValue([activeDrugs[0]]);

        const result = await service.updateItems('rx-01', { items: [baseDto.items[0]] } as any, currentUser);

        expect(mockTx.prescriptionItem.deleteMany).toHaveBeenCalledWith({ where: { prescriptionId: 'rx-01' } });
        expect(mockSafetyOrchestrator.run).toHaveBeenCalledWith('rx-01');
        expect(result).toEqual(updatedRx);
    });

    it('F-13 [Abnormal]: updateItems should throw ForbiddenException when prescription is not in draft status', async () => {
        mockPrisma.prescription.findUnique.mockResolvedValue({
            prescriptionId: 'rx-01',
            doctorId: doctor.doctorId,
            status: 'signed',
        });

        await expect(service.updateItems('rx-01', { items: [baseDto.items[0]] } as any, currentUser)).rejects.toThrow(
            ForbiddenException,
        );
    });

    it('F-13 [Normal/Abnormal]: cancel should transition draft to cancelled and reject already cancelled', async () => {
        mockPrisma.prescription.findUnique.mockResolvedValueOnce({
            prescriptionId: 'rx-01',
            doctorId: doctor.doctorId,
            status: 'draft',
        });
        mockPrisma.prescription.update.mockResolvedValueOnce({
            prescriptionId: 'rx-01',
            status: 'cancelled',
        });

        const cancelled = await service.cancel('rx-01', currentUser);
        expect(cancelled.status).toBe('cancelled');

        mockPrisma.prescription.findUnique.mockResolvedValueOnce({
            prescriptionId: 'rx-01',
            doctorId: doctor.doctorId,
            status: 'cancelled',
        });
        await expect(service.cancel('rx-01', currentUser)).rejects.toThrow(BadRequestException);
    });

    it('F-13 Safety [Normal]: AllergyContraindicationDetector should flag drug matching patient active allergy', async () => {
        const detectorPrisma = {
            patientAllergy: {
                findMany: jest.fn().mockResolvedValue([
                    { allergyText: '[DRUG] Atorvastatin; [FOOD] Tôm', status: 'active' },
                ]),
            },
        };
        const detector = new AllergyContraindicationDetector(detectorPrisma as any);
        const items = [
            {
                prescriptionItemId: 'item-1',
                drug: {
                    drugName: 'Atorvastatin 20mg',
                    genericName: 'Atorvastatin',
                },
            },
        ] as any;

        const alerts = await detector.detect('rx-01', items, 'pat-01');
        expect(alerts).toHaveLength(1);
        expect(alerts[0].alertType).toBe('allergy_contraindication');
        expect(alerts[0].relatedItemIdA).toBe('item-1');
    });

    it('F-13 Safety [Normal]: DuplicateTherapeuticClassDetector should flag two drugs sharing therapeuticClass', async () => {
        const detector = new DuplicateTherapeuticClassDetector();
        const items = [
            {
                prescriptionItemId: 'item-1',
                drug: { drugName: 'Atorvastatin 20mg', therapeuticClass: 'Statin' },
            },
            {
                prescriptionItemId: 'item-2',
                drug: { drugName: 'Rosuvastatin 10mg', therapeuticClass: 'Statin' },
            },
        ] as any;

        const alerts = await detector.detect('rx-01', items, 'pat-01');
        expect(alerts).toHaveLength(1);
        expect(alerts[0].alertType).toBe('duplicate_therapeutic_class');
        expect(alerts[0].severity).toBe('moderate');
    });
});
