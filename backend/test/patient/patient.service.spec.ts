import { ConflictException, ForbiddenException } from '@nestjs/common';
import { PatientService } from '../../src/modules/patient-flow/appointment-registration/patient/patient.service';
import { PatientGender } from '../../src/modules/patient-flow/appointment-registration/patient/dto/create-patient.dto';

describe('PatientService', () => {
  const patient = {
    patientId: 'patient-1',
    patientCode: 'BN260101000001',
    userId: null,
    fullName: 'Nguyen Van A',
    dateOfBirth: new Date('1990-05-20'),
    gender: PatientGender.MALE,
    identityNumber: '079090001234',
    insuranceNumber: null,
    phoneNumber: '0901234567',
    status: 'main',
  };

  const dto = {
    fullName: 'Nguyen Van A',
    dateOfBirth: '1990-05-20',
    gender: PatientGender.MALE,
    identityNumber: '079090001234',
    phoneNumber: '0901234567',
  };

  const user = {
    userId: 'user-1',
    email: 'patient@example.com',
    permissions: ['patient:create:own'],
  };

  let prisma: {
    patient: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let service: PatientService;

  beforeEach(() => {
    prisma = {
      patient: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue(patient),
        update: jest.fn().mockResolvedValue(patient),
      },
    };
    service = new PatientService(prisma as never);
  });

  it('creates a self-service patient linked to the current user', async () => {
    await service.create(dto, user);

    expect(prisma.patient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: user.userId,
          fullName: dto.fullName,
          identityNumber: dto.identityNumber,
          status: 'main',
        }),
      }),
    );
  });

  it('rejects a second self-service patient for the same user', async () => {
    prisma.patient.findUnique.mockResolvedValue(patient);

    await expect(service.create(dto, user)).rejects.toThrow(ConflictException);
    expect(prisma.patient.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate identity number', async () => {
    prisma.patient.findFirst.mockResolvedValue({
      identityNumber: dto.identityNumber,
      insuranceNumber: null,
      email: null,
    });

    await expect(service.create(dto, user)).rejects.toThrow('Số CCCD/CMND đã được sử dụng');
  });

  it('prevents a user from viewing another user full profile', async () => {
    prisma.patient.findUnique.mockResolvedValue({ ...patient, userId: 'another-user' });

    await expect(service.getFullProfile(patient.patientId, user)).rejects.toThrow(
      ForbiddenException,
    );
  });
});
