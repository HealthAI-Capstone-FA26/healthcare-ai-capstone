import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { DoctorEncounterAccessService } from '../../src/modules/clinical/pre-doctor-examination/common/doctor-encounter-access.service';
import { DOCTOR_WRITABLE_STATUSES } from '../../src/modules/clinical/pre-doctor-examination/common/encounter-status.guard';
import { EncounterStatus } from '../../src/common/utils/encounter-status.util';
import { ACTOR_ROLE } from '../../src/common/constants/actor-role.constant';

describe('DoctorEncounterAccessService - prepareWrite (Function 12)', () => {
  let service: DoctorEncounterAccessService;
  let mockPrisma: any;
  let mockActorRoleService: any;
  let mockDoctorService: any;

  const mockDoctor = {
    doctorId: 'doc-01',
    userId: 'user-doc-01',
    fullName: 'BS. CKII Nguyen Van Tim',
    specialization: 'Tim mach',
  };

  beforeEach(() => {
    mockPrisma = {
      encounter: {
        findUnique: jest.fn(),
      },
    };

    mockActorRoleService = {
      assertActorRole: jest.fn(),
    };

    mockDoctorService = {
      findByUserId: jest.fn(),
    };

    service = new DoctorEncounterAccessService(
      mockPrisma as any,
      mockActorRoleService as any,
      mockDoctorService as any,
    );
  });

  // UTCID01 [Normal]: Bác sĩ hợp lệ, đúng bác sĩ phụ trách (doctorId = 'doc-01'), trạng thái 'in_progress'
  it('UTCID01 [N]: should return doctor and encounter when assigned doctor accesses an in_progress encounter', async () => {
    // Arrange
    const mockEncounter = {
      encounterId: 'enc-01',
      doctorId: 'doc-01',
      status: EncounterStatus.IN_PROGRESS,
    };

    mockActorRoleService.assertActorRole.mockResolvedValue(undefined);
    mockDoctorService.findByUserId.mockResolvedValue(mockDoctor);
    mockPrisma.encounter.findUnique.mockResolvedValue(mockEncounter);

    // Act
    const result = await service.prepareWrite(
      'enc-01',
      'user-doc-01',
      DOCTOR_WRITABLE_STATUSES,
      'ghi nhận khám lâm sàng',
    );

    // Assert
    expect(mockActorRoleService.assertActorRole).toHaveBeenCalledWith('user-doc-01', [ACTOR_ROLE.DOCTOR]);
    expect(mockDoctorService.findByUserId).toHaveBeenCalledWith('user-doc-01');
    expect(mockPrisma.encounter.findUnique).toHaveBeenCalledWith({ where: { encounterId: 'enc-01' } });
    expect(result).toEqual({
      doctor: mockDoctor,
      encounter: mockEncounter,
    });
  });

  // UTCID02 [Normal]: Bác sĩ hợp lệ, lượt khám chưa gán bác sĩ (doctorId = null), trạng thái 'in_progress'
  it('UTCID02 [N]: should allow access when encounter has no assigned doctor yet (doctorId = null)', async () => {
    // Arrange
    const mockUnassignedEncounter = {
      encounterId: 'enc-02',
      doctorId: null,
      status: EncounterStatus.IN_PROGRESS,
    };

    mockActorRoleService.assertActorRole.mockResolvedValue(undefined);
    mockDoctorService.findByUserId.mockResolvedValue(mockDoctor);
    mockPrisma.encounter.findUnique.mockResolvedValue(mockUnassignedEncounter);

    // Act
    const result = await service.prepareWrite(
      'enc-02',
      'user-doc-01',
      DOCTOR_WRITABLE_STATUSES,
      'ghi nhận khám lâm sàng',
    );

    // Assert
    expect(result).toEqual({
      doctor: mockDoctor,
      encounter: mockUnassignedEncounter,
    });
  });

  // UTCID03 [Abnormal]: Người dùng không có vai trò DOCTOR (vd: RECEPTIONIST / PATIENT) -> ForbiddenException
  it('UTCID03 [A]: should throw ForbiddenException when currentUserId does not have DOCTOR role', async () => {
    // Arrange
    mockActorRoleService.assertActorRole.mockRejectedValue(
      new ForbiddenException('Người dùng không có vai trò Bác sĩ'),
    );

    // Act & Assert
    await expect(
      service.prepareWrite(
        'enc-01',
        'user-receptionist-01',
        DOCTOR_WRITABLE_STATUSES,
        'ghi nhận khám lâm sàng',
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(mockDoctorService.findByUserId).not.toHaveBeenCalled();
    expect(mockPrisma.encounter.findUnique).not.toHaveBeenCalled();
  });

  // UTCID04 [Abnormal]: Lượt khám không tồn tại (enc-404) -> NotFoundException
  it('UTCID04 [A]: should throw NotFoundException when encounter does not exist', async () => {
    // Arrange
    mockActorRoleService.assertActorRole.mockResolvedValue(undefined);
    mockDoctorService.findByUserId.mockResolvedValue(mockDoctor);
    mockPrisma.encounter.findUnique.mockResolvedValue(null);

    // Act & Assert
    await expect(
      service.prepareWrite(
        'enc-404',
        'user-doc-01',
        DOCTOR_WRITABLE_STATUSES,
        'ghi nhận khám lâm sàng',
      ),
    ).rejects.toThrow(NotFoundException);
  });

  // UTCID05 [Abnormal]: Lượt khám thuộc bác sĩ khác phụ trách (doctorId = 'doc-02') -> ForbiddenException
  it('UTCID05 [A]: should throw ForbiddenException when encounter belongs to another doctor', async () => {
    // Arrange
    const mockOtherDoctorEncounter = {
      encounterId: 'enc-01',
      doctorId: 'doc-02',
      status: EncounterStatus.IN_PROGRESS,
    };

    mockActorRoleService.assertActorRole.mockResolvedValue(undefined);
    mockDoctorService.findByUserId.mockResolvedValue(mockDoctor);
    mockPrisma.encounter.findUnique.mockResolvedValue(mockOtherDoctorEncounter);

    // Act & Assert
    await expect(
      service.prepareWrite(
        'enc-01',
        'user-doc-01',
        DOCTOR_WRITABLE_STATUSES,
        'ghi nhận khám lâm sàng',
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // UTCID06 [Boundary]: Lượt khám đã kết thúc (status = 'finished', trạng thái đóng biên ngoài allowedStatuses) -> BadRequestException
  it('UTCID06 [B]: should throw BadRequestException when encounter is already finished (outside allowedStatuses)', async () => {
    // Arrange
    const mockFinishedEncounter = {
      encounterId: 'enc-01',
      doctorId: 'doc-01',
      status: EncounterStatus.FINISHED,
    };

    mockActorRoleService.assertActorRole.mockResolvedValue(undefined);
    mockDoctorService.findByUserId.mockResolvedValue(mockDoctor);
    mockPrisma.encounter.findUnique.mockResolvedValue(mockFinishedEncounter);

    // Act & Assert
    await expect(
      service.prepareWrite(
        'enc-01',
        'user-doc-01',
        DOCTOR_WRITABLE_STATUSES,
        'ghi nhận khám lâm sàng',
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

