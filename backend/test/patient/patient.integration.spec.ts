import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { JwtAuthGuard } from '../../src/common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../src/common/guards/permissions.guard';
import { PatientController } from '../../src/modules/patient-flow/appointment-registration/patient/patient.controller';
import { PatientService } from '../../src/modules/patient-flow/appointment-registration/patient/patient.service';
import { PatientGender } from '../../src/modules/patient-flow/appointment-registration/patient/dto/create-patient.dto';

describe('PatientController integration', () => {
  let app: INestApplication;

  const patientService = {
    create: jest.fn(),
    search: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
  };

  const currentUser = {
    userId: 'user-1',
    email: 'patient@example.com',
    permissions: ['patient:create:own'],
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PatientController],
      providers: [{ provide: PatientService, useValue: patientService }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: { switchToHttp: () => { getRequest: () => { user: typeof currentUser } } }) => {
          context.switchToHttp().getRequest().user = currentUser;
          return true;
        },
      })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('creates a patient and passes the authenticated user to the service', async () => {
    const dto = {
      fullName: 'Nguyen Van A',
      dateOfBirth: '1990-05-20',
      gender: PatientGender.MALE,
      identityNumber: '079090001234',
      phoneNumber: '0901234567',
    };
    const createdPatient = { patientId: 'patient-1', ...dto };
    patientService.create.mockResolvedValue(createdPatient);

    await request(app.getHttpServer())
      .post('/patients')
      .send(dto)
      .expect(201)
      .expect(createdPatient);

    expect(patientService.create).toHaveBeenCalledWith(dto, currentUser);
  });

  it('rejects invalid patient data before calling the service', async () => {
    await request(app.getHttpServer())
      .post('/patients')
      .send({
        fullName: '',
        dateOfBirth: 'not-a-date',
        gender: 'invalid',
      })
      .expect(400);

    expect(patientService.create).not.toHaveBeenCalled();
  });

  it('searches patients using the query string', async () => {
    const patients = [{ patientId: 'patient-1', fullName: 'Nguyen Van A' }];
    patientService.search.mockResolvedValue(patients);

    await request(app.getHttpServer())
      .get('/patients')
      .query({ search: 'Nguyen' })
      .expect(200)
      .expect(patients);

    expect(patientService.search).toHaveBeenCalledWith({ search: 'Nguyen' });
  });

  it('updates a patient through the HTTP endpoint', async () => {
    const updatedPatient = { patientId: 'patient-1', fullName: 'Tran Van B' };
    patientService.update.mockResolvedValue(updatedPatient);

    await request(app.getHttpServer())
      .patch('/patients/patient-1')
      .send({ fullName: 'Tran Van B' })
      .expect(200)
      .expect(updatedPatient);

    expect(patientService.update).toHaveBeenCalledWith(
      'patient-1',
      { fullName: 'Tran Van B' },
      currentUser,
    );
  });
});
