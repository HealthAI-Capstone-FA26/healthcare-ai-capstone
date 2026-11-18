import {
    BadRequestException,
    ConflictException,
    NotFoundException,
} from '@nestjs/common';
import { InitialDiagnosisService } from '../../src/modules/clinical/pre-doctor-examination/initial-diagnosis/initial-diagnosis.service';
import { DOCTOR_WRITABLE_STATUSES } from '../../src/modules/clinical/pre-doctor-examination/common/encounter-status.guard';
import { EncounterStatus } from '../../src/common/utils/encounter-status.util';
import { CreateInitialDiagnosisDto } from '../../src/modules/clinical/pre-doctor-examination/initial-diagnosis/dto/create-initial-diagnosis.dto';

describe('InitialDiagnosisService - Function 14: create', () => {
    let service: InitialDiagnosisService;
    let mockTx: any;
    let mockPrismaService: any;
    let mockAccessService: any;
    let mockIcd10CatalogService: any;

    const encounterId = 'enc-001';
    const currentUserId = 'user-doc-001';
    const mockDoctor = { doctorId: 'doc-001' };
    const mockEncounter = {
        encounterId,
        patientId: 'pat-001',
        doctorId: 'doc-001',
        status: EncounterStatus.IN_PROGRESS,
    };

    const activeIcd10 = {
        icd10Code: 'I20.0',
        icd10Name: 'Đau thắt ngực không ổn định',
        isActive: true,
    };

    beforeEach(() => {
        mockTx = {
            $executeRaw: jest.fn().mockResolvedValue(1),
            diagnosis: {
                findFirst: jest.fn(),
                count: jest.fn(),
                updateMany: jest.fn(),
                create: jest.fn(),
            },
        };

        mockPrismaService = {
            $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) =>
                callback(mockTx),
            ),
        };

        mockAccessService = {
            prepareWrite: jest.fn().mockResolvedValue({
                doctor: mockDoctor,
                encounter: mockEncounter,
            }),
            startExaminationIfNeeded: jest.fn().mockResolvedValue(false),
        };

        mockIcd10CatalogService = {
            getByCode: jest.fn(),
        };

        service = new InitialDiagnosisService(
            mockPrismaService as any,
            mockAccessService as any,
            mockIcd10CatalogService as any,
        );
    });

    // UTCID01: Normal - Tạo chẩn đoán sơ bộ đầu tiên (0 existing) -> tự động gán isPrimary = true
    it('UTCID01: should create initial diagnosis and auto-set isPrimary = true when 0 primary diagnosis exists', async () => {
        const dto: CreateInitialDiagnosisDto = {
            icd10Code: 'I20.0',
            notes: 'Đau ngực sau xương ức lan lên vai trái',
        };

        mockIcd10CatalogService.getByCode.mockResolvedValue(activeIcd10);
        mockTx.diagnosis.findFirst.mockResolvedValue(null);
        mockTx.diagnosis.count.mockResolvedValue(0);

        const createdDiagnosis = {
            diagnosisId: 'diag-001',
            encounterId,
            icd10Code: 'I20.0',
            diagnosisName: activeIcd10.icd10Name,
            diagnosisType: 'initial',
            doctorId: mockDoctor.doctorId,
            isPrimary: true,
            notes: dto.notes,
            icd10: activeIcd10,
        };
        mockTx.diagnosis.create.mockResolvedValue(createdDiagnosis);

        const result = await service.create(encounterId, dto, currentUserId);

        expect(mockAccessService.prepareWrite).toHaveBeenCalledWith(
            encounterId,
            currentUserId,
            DOCTOR_WRITABLE_STATUSES,
            'ghi nhận chẩn đoán',
        );
        expect(mockIcd10CatalogService.getByCode).toHaveBeenCalledWith('I20.0');
        expect(mockTx.diagnosis.updateMany).not.toHaveBeenCalled();
        expect(mockTx.diagnosis.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    encounterId,
                    icd10Code: 'I20.0',
                    diagnosisName: activeIcd10.icd10Name,
                    diagnosisType: 'initial',
                    doctorId: mockDoctor.doctorId,
                    isPrimary: true,
                }),
            }),
        );
        expect(mockAccessService.startExaminationIfNeeded).toHaveBeenCalledWith(
            mockTx,
            mockEncounter,
            mockDoctor.doctorId,
        );
        expect(result).toEqual(createdDiagnosis);
    });

    // UTCID02: Normal - Đã có 1 chẩn đoán chính, tạo thêm chẩn đoán phụ (isPrimary = false)
    it('UTCID02: should create secondary initial diagnosis (isPrimary = false) when 1 primary diagnosis already exists', async () => {
        const dto: CreateInitialDiagnosisDto = {
            icd10Code: 'I20.0',
            isPrimary: false,
            notes: 'Chẩn đoán kèm theo',
        };

        mockIcd10CatalogService.getByCode.mockResolvedValue(activeIcd10);
        mockTx.diagnosis.findFirst.mockResolvedValue(null);
        mockTx.diagnosis.count.mockResolvedValue(1);

        const createdSecondary = {
            diagnosisId: 'diag-002',
            encounterId,
            icd10Code: 'I20.0',
            diagnosisName: activeIcd10.icd10Name,
            diagnosisType: 'initial',
            doctorId: mockDoctor.doctorId,
            isPrimary: false,
            notes: dto.notes,
            icd10: activeIcd10,
        };
        mockTx.diagnosis.create.mockResolvedValue(createdSecondary);

        const result = await service.create(encounterId, dto, currentUserId);

        expect(mockTx.diagnosis.updateMany).not.toHaveBeenCalled();
        expect(mockTx.diagnosis.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    encounterId,
                    icd10Code: 'I20.0',
                    diagnosisType: 'initial',
                    isPrimary: false,
                }),
            }),
        );
        expect(result).toEqual(createdSecondary);
    });

    // UTCID03: Abnormal - Mã ICD-10 không tồn tại trong danh mục ("Z99.9") -> NotFoundException
    it('UTCID03: should throw NotFoundException when icd10Code does not exist in ICD-10 catalog', async () => {
        const dto: CreateInitialDiagnosisDto = {
            icd10Code: 'Z99.9',
        };

        mockIcd10CatalogService.getByCode.mockRejectedValue(
            new NotFoundException('Không tìm thấy mã ICD-10 Z99.9'),
        );

        await expect(
            service.create(encounterId, dto, currentUserId),
        ).rejects.toThrow(NotFoundException);

        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    // UTCID04: Abnormal - Mã ICD-10 tồn tại nhưng đã ngưng sử dụng (isActive = false) -> BadRequestException
    it('UTCID04: should throw BadRequestException when icd10Code is inactive (isActive = false)', async () => {
        const dto: CreateInitialDiagnosisDto = {
            icd10Code: 'I20.9',
        };

        mockIcd10CatalogService.getByCode.mockResolvedValue({
            icd10Code: 'I20.9',
            icd10Name: 'Đau thắt ngực, không đặc hiệu',
            isActive: false,
        });

        await expect(
            service.create(encounterId, dto, currentUserId),
        ).rejects.toThrow(BadRequestException);

        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    // UTCID05: Abnormal - Trùng mã ICD-10 cùng loại trong cùng lượt khám -> ConflictException
    it('UTCID05: should throw ConflictException when encounter already has an initial diagnosis with the same icd10Code', async () => {
        const dto: CreateInitialDiagnosisDto = {
            icd10Code: 'I20.0',
        };

        mockIcd10CatalogService.getByCode.mockResolvedValue(activeIcd10);
        mockTx.diagnosis.findFirst.mockResolvedValue({
            diagnosisId: 'diag-existing',
        });

        await expect(
            service.create(encounterId, dto, currentUserId),
        ).rejects.toThrow(ConflictException);

        expect(mockTx.diagnosis.create).not.toHaveBeenCalled();
    });

    // UTCID06: Boundary - Đã có 1 chẩn đoán chính, tạo mới với isPrimary = true -> hạ cấp primary cũ và đặt primary mới
    it('UTCID06: should demote existing primary diagnosis and set new diagnosis as primary when dto.isPrimary = true', async () => {
        const dto: CreateInitialDiagnosisDto = {
            icd10Code: 'I20.0',
            isPrimary: true,
        };

        mockIcd10CatalogService.getByCode.mockResolvedValue(activeIcd10);
        mockTx.diagnosis.findFirst.mockResolvedValue(null);
        mockTx.diagnosis.count.mockResolvedValue(1);
        mockTx.diagnosis.updateMany.mockResolvedValue({ count: 1 });

        const createdNewPrimary = {
            diagnosisId: 'diag-003',
            encounterId,
            icd10Code: 'I20.0',
            diagnosisName: activeIcd10.icd10Name,
            diagnosisType: 'initial',
            doctorId: mockDoctor.doctorId,
            isPrimary: true,
            icd10: activeIcd10,
        };
        mockTx.diagnosis.create.mockResolvedValue(createdNewPrimary);

        const result = await service.create(encounterId, dto, currentUserId);

        expect(mockTx.diagnosis.updateMany).toHaveBeenCalledWith({
            where: { encounterId, diagnosisType: 'initial', isPrimary: true },
            data: { isPrimary: false },
        });
        expect(mockTx.diagnosis.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    encounterId,
                    icd10Code: 'I20.0',
                    diagnosisType: 'initial',
                    isPrimary: true,
                }),
            }),
        );
        expect(result).toEqual(createdNewPrimary);
    });
});

