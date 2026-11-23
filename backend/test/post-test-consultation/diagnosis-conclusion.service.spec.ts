import { BadRequestException, ConflictException } from '@nestjs/common';
import { DiagnosisConclusionService } from '../../src/modules/clinical/post-test-consultation/diagnosis-conclusion/diagnosis-conclusion.service';
import { CreateDiagnosisConclusionDto } from '../../src/modules/clinical/post-test-consultation/diagnosis-conclusion/dto/create-diagnosis-conclusion.dto';
import { EncounterStatus } from '../../src/common/utils/encounter-status.util';
import { ACTOR_ROLE } from '../../src/common/constants/actor-role.constant';

describe('DiagnosisConclusionService - Function 19: create', () => {
    let service: DiagnosisConclusionService;
    let mockPrismaService: any;
    let mockActorRoleService: any;
    let mockDoctorService: any;
    let mockIcd10CatalogService: any;
    let mockTx: any;

    const encounterId = 'enc-001';
    const currentUserId = 'user-doc-001';
    const mockDoctor = { doctorId: 'doc-001' };

    const activeIcd10 = {
        icd10Code: 'I21.0',
        icd10Name: 'Nhồi máu cơ tim cấp qua thành trước',
        isActive: true,
    };

    const inactiveIcd10 = {
        icd10Code: 'I99.0',
        icd10Name: 'Rối loạn hệ tuần hoàn khác',
        isActive: false,
    };

    beforeEach(() => {
        mockTx = {
            diagnosis: {
                findFirst: jest.fn(),
                count: jest.fn(),
                updateMany: jest.fn(),
                create: jest.fn(),
            },
        };

        mockPrismaService = {
            encounter: {
                findUnique: jest.fn().mockResolvedValue({
                    encounterId,
                    status: EncounterStatus.AWAITING_REVIEW,
                }),
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

        mockIcd10CatalogService = {
            getByCode: jest.fn(),
        };

        service = new DiagnosisConclusionService(
            mockPrismaService as any,
            mockActorRoleService as any,
            mockDoctorService as any,
            mockIcd10CatalogService as any,
        );
    });

    // UTCID01: Normal - 0 existing diagnoses, dto.isPrimary omitted -> defaults to true
    it('UTCID01 [Normal]: should create final diagnosis with isPrimary = true when no existing final diagnoses exist', async () => {
        const dto: CreateDiagnosisConclusionDto = {
            icd10Code: 'I21.0',
            notes: 'Nhồi máu cơ tim thành trước sau cận lâm sàng',
        };

        mockIcd10CatalogService.getByCode.mockResolvedValue(activeIcd10);
        mockTx.diagnosis.findFirst.mockResolvedValue(null);
        mockTx.diagnosis.count.mockResolvedValue(0);

        const expectedCreatedDiagnosis = {
            diagnosisId: 'diag-final-001',
            encounterId,
            icd10Code: 'I21.0',
            diagnosisName: activeIcd10.icd10Name,
            diagnosisType: 'final',
            doctorId: mockDoctor.doctorId,
            isPrimary: true,
            notes: dto.notes,
            diagnosedAt: expect.any(Date),
            icd10: activeIcd10,
        };
        mockTx.diagnosis.create.mockResolvedValue(expectedCreatedDiagnosis);

        const result = await service.create(encounterId, dto, currentUserId);

        expect(mockActorRoleService.assertActorRole).toHaveBeenCalledWith(currentUserId, [ACTOR_ROLE.DOCTOR]);
        expect(mockDoctorService.findByUserId).toHaveBeenCalledWith(currentUserId);
        expect(mockPrismaService.encounter.findUnique).toHaveBeenCalledWith({ where: { encounterId } });
        expect(mockIcd10CatalogService.getByCode).toHaveBeenCalledWith('I21.0');
        expect(mockTx.diagnosis.findFirst).toHaveBeenCalledWith({
            where: { encounterId, diagnosisType: 'final', icd10Code: 'I21.0' },
            select: { diagnosisId: true },
        });
        expect(mockTx.diagnosis.updateMany).not.toHaveBeenCalled();
        expect(mockTx.diagnosis.create).toHaveBeenCalledWith({
            data: {
                encounterId,
                icd10Code: 'I21.0',
                diagnosisName: activeIcd10.icd10Name,
                diagnosisType: 'final',
                doctorId: mockDoctor.doctorId,
                isPrimary: true,
                notes: dto.notes,
                diagnosedAt: expect.any(Date),
            },
            include: { icd10: true },
        });
        expect(result).toEqual(expectedCreatedDiagnosis);
    });

    // UTCID02: Normal - 1 existing diagnosis ("I10"), new dto.isPrimary = false
    it('UTCID02 [Normal]: should create final diagnosis with isPrimary = false when 1 existing diagnosis and isPrimary set to false', async () => {
        const dto: CreateDiagnosisConclusionDto = {
            icd10Code: 'I21.0',
            isPrimary: false,
            notes: 'Chẩn đoán kèm theo',
        };

        mockIcd10CatalogService.getByCode.mockResolvedValue(activeIcd10);
        mockTx.diagnosis.findFirst.mockResolvedValue(null);
        mockTx.diagnosis.count.mockResolvedValue(1);

        const expectedCreatedDiagnosis = {
            diagnosisId: 'diag-final-002',
            encounterId,
            icd10Code: 'I21.0',
            diagnosisName: activeIcd10.icd10Name,
            diagnosisType: 'final',
            doctorId: mockDoctor.doctorId,
            isPrimary: false,
            notes: dto.notes,
            diagnosedAt: expect.any(Date),
            icd10: activeIcd10,
        };
        mockTx.diagnosis.create.mockResolvedValue(expectedCreatedDiagnosis);

        const result = await service.create(encounterId, dto, currentUserId);

        expect(mockTx.diagnosis.updateMany).not.toHaveBeenCalled();
        expect(mockTx.diagnosis.create).toHaveBeenCalledWith({
            data: {
                encounterId,
                icd10Code: 'I21.0',
                diagnosisName: activeIcd10.icd10Name,
                diagnosisType: 'final',
                doctorId: mockDoctor.doctorId,
                isPrimary: false,
                notes: dto.notes,
                diagnosedAt: expect.any(Date),
            },
            include: { icd10: true },
        });
        expect(result).toEqual(expectedCreatedDiagnosis);
    });

    // UTCID03: Abnormal - encounter status is "awaiting_diagnostics" (Lab tests still pending)
    it('UTCID03 [Abnormal]: should throw BadRequestException when encounter status is awaiting_diagnostics', async () => {
        const dto: CreateDiagnosisConclusionDto = {
            icd10Code: 'I21.0',
        };

        mockPrismaService.encounter.findUnique.mockResolvedValue({
            encounterId,
            status: EncounterStatus.AWAITING_DIAGNOSTICS,
        });

        await expect(service.create(encounterId, dto, currentUserId)).rejects.toThrow(BadRequestException);
        await expect(service.create(encounterId, dto, currentUserId)).rejects.toThrow(
            /Các chỉ định cận lâm sàng chưa hoàn tất/i,
        );
        expect(mockIcd10CatalogService.getByCode).not.toHaveBeenCalled();
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    // UTCID04: Abnormal - inactive ICD-10 code (isActive = false)
    it('UTCID04 [Abnormal]: should throw BadRequestException when ICD-10 code is inactive (I99.0)', async () => {
        const dto: CreateDiagnosisConclusionDto = {
            icd10Code: 'I99.0',
        };

        mockIcd10CatalogService.getByCode.mockResolvedValue(inactiveIcd10);

        await expect(service.create(encounterId, dto, currentUserId)).rejects.toThrow(BadRequestException);
        await expect(service.create(encounterId, dto, currentUserId)).rejects.toThrow(
            "Mã ICD-10 'I99.0' đã ngưng sử dụng, vui lòng chọn mã khác.",
        );
        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    // UTCID05: Abnormal - 1 existing with same "I21.0" (Duplicate final diagnosis)
    it('UTCID05 [Abnormal]: should throw ConflictException when final diagnosis with same ICD-10 code already exists', async () => {
        const dto: CreateDiagnosisConclusionDto = {
            icd10Code: 'I21.0',
        };

        mockIcd10CatalogService.getByCode.mockResolvedValue(activeIcd10);
        mockTx.diagnosis.findFirst.mockResolvedValue({ diagnosisId: 'diag-existing-001' });

        await expect(service.create(encounterId, dto, currentUserId)).rejects.toThrow(ConflictException);
        await expect(service.create(encounterId, dto, currentUserId)).rejects.toThrow(
            'Lượt khám đã có chẩn đoán chính thức mã I21.0 (diag-existing-001).',
        );
        expect(mockTx.diagnosis.create).not.toHaveBeenCalled();
    });

    // UTCID06: Boundary - 1 existing primary ("I10"), new dto.isPrimary = true -> replaces primary
    it('UTCID06 [Boundary]: should demote previous primary diagnosis when new final diagnosis has isPrimary = true', async () => {
        const dto: CreateDiagnosisConclusionDto = {
            icd10Code: 'I21.0',
            isPrimary: true,
            notes: 'Thay thế chẩn đoán chính cũ',
        };

        mockIcd10CatalogService.getByCode.mockResolvedValue(activeIcd10);
        mockTx.diagnosis.findFirst.mockResolvedValue(null);
        mockTx.diagnosis.count.mockResolvedValue(1);

        const expectedCreatedDiagnosis = {
            diagnosisId: 'diag-final-003',
            encounterId,
            icd10Code: 'I21.0',
            diagnosisName: activeIcd10.icd10Name,
            diagnosisType: 'final',
            doctorId: mockDoctor.doctorId,
            isPrimary: true,
            notes: dto.notes,
            diagnosedAt: expect.any(Date),
            icd10: activeIcd10,
        };
        mockTx.diagnosis.create.mockResolvedValue(expectedCreatedDiagnosis);

        const result = await service.create(encounterId, dto, currentUserId);

        expect(mockTx.diagnosis.updateMany).toHaveBeenCalledWith({
            where: { encounterId, diagnosisType: 'final', isPrimary: true },
            data: { isPrimary: false },
        });
        expect(mockTx.diagnosis.create).toHaveBeenCalledWith({
            data: {
                encounterId,
                icd10Code: 'I21.0',
                diagnosisName: activeIcd10.icd10Name,
                diagnosisType: 'final',
                doctorId: mockDoctor.doctorId,
                isPrimary: true,
                notes: dto.notes,
                diagnosedAt: expect.any(Date),
            },
            include: { icd10: true },
        });
        expect(result).toEqual(expectedCreatedDiagnosis);
    });
});
