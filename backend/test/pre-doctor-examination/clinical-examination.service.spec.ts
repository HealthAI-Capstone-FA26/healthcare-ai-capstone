import {
    ConflictException,
    ForbiddenException,
    NotFoundException,
} from '@nestjs/common';
import { ClinicalExaminationService } from '../../src/modules/clinical/pre-doctor-examination/clinical-examination/clinical-examination.service';
import { DOCTOR_WRITABLE_STATUSES } from '../../src/modules/clinical/pre-doctor-examination/common/encounter-status.guard';
import { EncounterStatus } from '../../src/common/utils/encounter-status.util';
import { UpsertClinicalExaminationDto } from '../../src/modules/clinical/pre-doctor-examination/clinical-examination/dto/upsert-clinical-examination.dto';

describe('ClinicalExaminationService - Function 13: upsert', () => {
    let service: ClinicalExaminationService;
    let mockTx: any;
    let mockPrismaService: any;
    let mockAccessService: any;

    const encounterId = 'enc-001';
    const currentUserId = 'user-doc-001';
    const mockDoctor = { doctorId: 'doc-001' };
    const mockEncounter = {
        encounterId,
        patientId: 'pat-001',
        doctorId: 'doc-001',
        status: EncounterStatus.IN_PROGRESS,
    };

    const fullCardiovascularDto: UpsertClinicalExaminationDto = {
        patientPosition: 'Nằm ngửa, đầu cao 30 độ',
        inspectionFindings: 'Da niêm mạc hồng hào',
        palpationFindings: 'Mỏm tim KLS 5 đường trung đòn trái',
        percussionFindings: 'Phổi gõ trong 2 bên',
        auscultationFindings: 'Tim đều, T1 T2 rõ, không âm thổi',
        clinicalNotes: 'Chưa phát hiện hội chứng suy tim',
        structured: {
            inspection: {
                skinMucosa: { normal: true },
                chestShape: 'symmetric',
            },
            palpation: {
                apex: {
                    intercostalSpace: '5',
                    line: 'trung đòn trái',
                    dynamics: 'normal',
                },
                thrill: { present: false },
            },
            percussion: {
                cardiacDullness: 'normal',
            },
            auscultation: {
                heartRate: 78,
                rhythm: 'regular',
                heartSounds: { normal: true },
                murmurs: { none: true },
            },
        },
    };

    beforeEach(() => {
        mockTx = {
            $executeRaw: jest.fn().mockResolvedValue(1),
            clinicalExamination: {
                findUnique: jest.fn(),
                upsert: jest.fn(),
            },
        };

        mockPrismaService = {
            $transaction: jest.fn((callback: (tx: any) => Promise<unknown>) =>
                callback(mockTx),
            ),
        };

        mockAccessService = {
            prepareWrite: jest.fn(),
            startExaminationIfNeeded: jest.fn().mockResolvedValue(false),
        };

        service = new ClinicalExaminationService(
            mockPrismaService as any,
            mockAccessService as any,
        );
    });

    // UTCID01: Normal - Tạo mới bản ghi khám lâm sàng tim mạch với đầy đủ thông tin khi chưa có bản ghi trước đó
    it('UTCID01: should create a new ClinicalExamination record with full cardiovascular findings when existing record is null', async () => {
        mockAccessService.prepareWrite.mockResolvedValue({
            doctor: mockDoctor,
            encounter: mockEncounter,
        });
        mockTx.clinicalExamination.findUnique.mockResolvedValue(null);

        const createdRecord = {
            examId: 'exam-001',
            encounterId,
            doctorId: mockDoctor.doctorId,
            patientPosition: fullCardiovascularDto.patientPosition,
            inspectionFindings: fullCardiovascularDto.inspectionFindings,
            palpationFindings: fullCardiovascularDto.palpationFindings,
            percussionFindings: fullCardiovascularDto.percussionFindings,
            auscultationFindings: fullCardiovascularDto.auscultationFindings,
            clinicalNotes: fullCardiovascularDto.clinicalNotes,
            structuredFindings: fullCardiovascularDto.structured,
            examinedAt: new Date('2026-10-16T08:30:00.000Z'),
        };
        mockTx.clinicalExamination.upsert.mockResolvedValue(createdRecord);

        const result = await service.upsert(
            encounterId,
            fullCardiovascularDto,
            currentUserId,
        );

        expect(mockAccessService.prepareWrite).toHaveBeenCalledWith(
            encounterId,
            currentUserId,
            DOCTOR_WRITABLE_STATUSES,
            'ghi nhận khám lâm sàng',
        );
        expect(mockTx.clinicalExamination.findUnique).toHaveBeenCalledWith({
            where: { encounterId },
        });
        expect(mockTx.clinicalExamination.upsert).toHaveBeenCalledTimes(1);
        expect(mockAccessService.startExaminationIfNeeded).toHaveBeenCalledWith(
            mockTx,
            mockEncounter,
            mockDoctor.doctorId,
        );
        expect(result).toEqual(createdRecord);
    });

    // UTCID02: Normal - Cập nhật bản ghi khám lâm sàng đã tồn tại (merge structuredFindings và cập nhật kết quả)
    it('UTCID02: should update existing ClinicalExamination record and merge structuredFindings when record already exists', async () => {
        mockAccessService.prepareWrite.mockResolvedValue({
            doctor: mockDoctor,
            encounter: mockEncounter,
        });
        mockTx.clinicalExamination.findUnique.mockResolvedValue({
            examId: 'exam-001',
            encounterId,
            doctorId: mockDoctor.doctorId,
            structuredFindings: {
                assessment: {
                    summary: 'Theo dõi tăng huyết áp',
                },
            },
        });

        const updatedRecord = {
            examId: 'exam-001',
            encounterId,
            doctorId: mockDoctor.doctorId,
            patientPosition: fullCardiovascularDto.patientPosition,
            clinicalNotes: fullCardiovascularDto.clinicalNotes,
            structuredFindings: {
                assessment: {
                    summary: 'Theo dõi tăng huyết áp',
                },
                ...fullCardiovascularDto.structured,
            },
        };
        mockTx.clinicalExamination.upsert.mockResolvedValue(updatedRecord);

        const result = await service.upsert(
            encounterId,
            fullCardiovascularDto,
            currentUserId,
        );

        expect(mockTx.clinicalExamination.findUnique).toHaveBeenCalledWith({
            where: { encounterId },
        });
        expect(mockTx.clinicalExamination.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { encounterId },
                update: expect.objectContaining({
                    doctorId: mockDoctor.doctorId,
                    structuredFindings: expect.objectContaining({
                        assessment: { summary: 'Theo dõi tăng huyết áp' },
                        inspection: fullCardiovascularDto.structured?.inspection,
                    }),
                }),
            }),
        );
        expect(result).toEqual(updatedRecord);
    });

    // UTCID03: Boundary - Chỉ truyền tối thiểu 1 trường bắt buộc duy nhất (chỉ có ghi chú triệu chứng/lâm sàng)
    it('UTCID03: should create ClinicalExamination record when only minimum single required field is provided', async () => {
        mockAccessService.prepareWrite.mockResolvedValue({
            doctor: mockDoctor,
            encounter: mockEncounter,
        });
        mockTx.clinicalExamination.findUnique.mockResolvedValue(null);

        const minDto: UpsertClinicalExaminationDto = {
            clinicalNotes: 'Bệnh nhân tỉnh, tiếp xúc tốt, đau tức ngực nhẹ khi gắng sức',
        };

        const createdMinRecord = {
            examId: 'exam-002',
            encounterId,
            doctorId: mockDoctor.doctorId,
            clinicalNotes: minDto.clinicalNotes,
            examinedAt: new Date('2026-10-16T09:00:00.000Z'),
        };
        mockTx.clinicalExamination.upsert.mockResolvedValue(createdMinRecord);

        const result = await service.upsert(encounterId, minDto, currentUserId);

        expect(mockTx.clinicalExamination.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { encounterId },
                create: expect.objectContaining({
                    encounterId,
                    doctorId: mockDoctor.doctorId,
                    clinicalNotes: minDto.clinicalNotes,
                }),
            }),
        );
        expect(result).toEqual(createdMinRecord);
    });

    // UTCID04: Abnormal - Lượt khám không tồn tại (access.prepareWrite ném NotFoundException)
    it('UTCID04: should throw NotFoundException when encounterId does not exist', async () => {
        mockAccessService.prepareWrite.mockRejectedValue(
            new NotFoundException('Không tìm thấy lượt khám enc-invalid'),
        );

        await expect(
            service.upsert('enc-invalid', fullCardiovascularDto, currentUserId),
        ).rejects.toThrow(NotFoundException);

        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    // UTCID05: Abnormal - Bác sĩ hiện tại không phải bác sĩ phụ trách lượt khám (access.prepareWrite ném ForbiddenException)
    it('UTCID05: should throw ForbiddenException when current doctor is not assigned to the encounter', async () => {
        mockAccessService.prepareWrite.mockRejectedValue(
            new ForbiddenException(
                'Bác sĩ không phụ trách lượt khám này (assigned: doc-999)',
            ),
        );

        await expect(
            service.upsert(encounterId, fullCardiovascularDto, 'user-other-doc'),
        ).rejects.toThrow(ForbiddenException);

        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    // UTCID06: Abnormal - Lượt khám đã hoàn tất (status = completed, access.prepareWrite ném ConflictException)
    it('UTCID06: should throw ConflictException when encounter status is completed', async () => {
        mockAccessService.prepareWrite.mockRejectedValue(
            new ConflictException(
                `Không thể ghi nhận khám lâm sàng khi lượt khám đang ở trạng thái 'completed'.`,
            ),
        );

        await expect(
            service.upsert(encounterId, fullCardiovascularDto, currentUserId),
        ).rejects.toThrow(ConflictException);

        expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });
});
