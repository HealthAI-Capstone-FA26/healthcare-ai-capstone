import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { GuestAppointmentService } from '../../src/modules/patient-flow/appointment-registration/appointment/guest-appointment.service';

// OTP util được mock để test xác định (không phụ thuộc bcrypt/random)
jest.mock('../../src/modules/identity-access/auth/common/otp.util', () => ({
  generateOtp: () => '123456',
  hashOtp: async (otp: string) => `h:${otp}`,
  compareOtp: async (otp: string, hash: string) => hash === `h:${otp}`,
  otpExpiryDate: (minutes: number) => new Date(Date.now() + minutes * 60_000),
}));

const FUTURE = new Date('2099-01-01T08:00:00.000Z');

const makeSlot = (over: Record<string, any> = {}) => ({
  slotId: 'slot-01',
  status: 'free',
  capacity: 1,
  bookedCount: 0,
  slotStartTime: FUTURE,
  schedule: { doctorId: 'doc-01' },
  ...over,
});

const baseDto: any = {
  phoneNumber: '0901234567',
  email: 'guest@mail.vn',
  fullName: 'Nguyen Ba Anh Nguyen',
  dateOfBirth: '2005-01-01',
  gender: 'male',
  doctorId: 'doc-01',
  slotId: 'slot-01',
  reasonForVisit: 'Đau ngực',
  verifyMethod: 'email',
};

describe('GuestAppointmentService (F-03: guest booking needs a correct OTP)', () => {
  let service: GuestAppointmentService;
  let prisma: any;
  let redisClient: any;
  let mailService: any;
  let smsService: any;
  let otpStore: any;
  let patientService: any;

  beforeEach(() => {
    prisma = {
      appointmentSlot: { findUnique: jest.fn().mockResolvedValue(makeSlot()), updateMany: jest.fn(), update: jest.fn() },
      appointment: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() },
      patient: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    redisClient = { incr: jest.fn().mockResolvedValue(1), expire: jest.fn() };
    mailService = { sendGuestAppointmentOtpMail: jest.fn() };
    smsService = { sendGuestAppointmentOtpSms: jest.fn() };
    otpStore = {
      find: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      incrementAttempts: jest.fn().mockResolvedValue(undefined),
    };
    patientService = { createDraftPatientRecord: jest.fn().mockResolvedValue({ patientId: 'pat-new' }) };

    service = new GuestAppointmentService(
      prisma,
      { getClient: () => redisClient } as any,
      { get: jest.fn().mockReturnValue('5') } as any,
      mailService,
      smsService,
      otpStore,
      patientService,
    );
  });

  // ---------------------------------------------------------------- requestOtp
  describe('requestOtp', () => {
    it('UTCID01 [N]: email channel -> OTP mailed and pending request stored by phone number', async () => {
      await service.requestOtp(baseDto);

      expect(mailService.sendGuestAppointmentOtpMail).toHaveBeenCalledWith('guest@mail.vn', '123456');
      expect(smsService.sendGuestAppointmentOtpSms).not.toHaveBeenCalled();
      expect(otpStore.upsert).toHaveBeenCalledWith(
        '0901234567',
        expect.objectContaining({ phoneNumber: '0901234567', otpCodeHash: 'h:123456', appointmentData: baseDto }),
      );
    });

    it('UTCID02 [N]: sms channel -> OTP sent by SMS', async () => {
      await service.requestOtp({ ...baseDto, verifyMethod: 'sms', email: undefined });

      expect(smsService.sendGuestAppointmentOtpSms).toHaveBeenCalledWith('0901234567', '123456');
      expect(mailService.sendGuestAppointmentOtpMail).not.toHaveBeenCalled();
    });

    it('UTCID03 [A]: email channel without email -> BadRequestException, nothing sent', async () => {
      await expect(service.requestOtp({ ...baseDto, email: undefined })).rejects.toThrow(BadRequestException);
      expect(otpStore.upsert).not.toHaveBeenCalled();
    });

    it('UTCID04 [A]: a full slot is rejected BEFORE any OTP is sent (DS-02 step 1)', async () => {
      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ status: 'full', bookedCount: 1 }));

      await expect(service.requestOtp(baseDto)).rejects.toThrow(BadRequestException);
      expect(mailService.sendGuestAppointmentOtpMail).not.toHaveBeenCalled();
      expect(otpStore.upsert).not.toHaveBeenCalled();
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });

    it('UTCID05 [A]: slot of another doctor is rejected', async () => {
      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ schedule: { doctorId: 'doc-99' } }));

      await expect(service.requestOtp(baseDto)).rejects.toThrow(BadRequestException);
    });

    it('UTCID06 [A]: phone already belongs to a patient with a different full name -> ConflictException', async () => {
      prisma.patient.findMany.mockResolvedValue([
        { patientId: 'p1', phoneNumber: '0901234567', email: null, fullName: 'Tran Thi Mai', status: 'main' },
      ]);

      await expect(service.requestOtp(baseDto)).rejects.toThrow(ConflictException);
      expect(mailService.sendGuestAppointmentOtpMail).not.toHaveBeenCalled();
    });

    it('UTCID07 [B]: 5th request in the window is allowed, 6th is blocked by the rate limit', async () => {
      redisClient.incr.mockResolvedValue(5);
      await expect(service.requestOtp(baseDto)).resolves.toBeDefined();

      redisClient.incr.mockResolvedValue(6);
      await expect(service.requestOtp(baseDto)).rejects.toThrow(BadRequestException);
      expect(mailService.sendGuestAppointmentOtpMail).toHaveBeenCalledTimes(1);
    });

    it('UTCID08 [B]: rate-limit window (expire) is armed only on the first request', async () => {
      redisClient.incr.mockResolvedValue(1);
      await service.requestOtp(baseDto);
      expect(redisClient.expire).toHaveBeenCalledWith('guest-appointment-otp-rl:0901234567', 600);

      redisClient.expire.mockClear();
      redisClient.incr.mockResolvedValue(2);
      await service.requestOtp(baseDto);
      expect(redisClient.expire).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------- verifyOtp
  describe('verifyOtp', () => {
    const verifyDto: any = { phoneNumber: '0901234567', otp: '123456', email: 'guest@mail.vn' };
    const pending = (over: Record<string, any> = {}) => ({
      phoneNumber: '0901234567',
      email: 'guest@mail.vn',
      appointmentData: baseDto,
      otpCodeHash: 'h:123456',
      otpExpiresAt: new Date(Date.now() + 5 * 60_000),
      attempts: 0,
      ...over,
    });

    beforeEach(() => {
      otpStore.find.mockResolvedValue(pending());
      prisma.appointmentSlot.updateMany.mockResolvedValue({ count: 1 });
      prisma.appointment.create.mockImplementation(async ({ data }: any) => ({ appointmentId: 'apt-01', ...data }));
    });

    it('UTCID01 [N]: correct OTP + new guest -> Appointment(pending, online) + draft Patient, slot becomes full, OTP deleted', async () => {
      const result = await service.verifyOtp(verifyDto);

      expect(patientService.createDraftPatientRecord).toHaveBeenCalledWith(
        expect.objectContaining({ fullName: 'Nguyen Ba Anh Nguyen', phoneNumber: '0901234567' }),
        prisma,
      );
      expect(result).toMatchObject({
        bookingChannel: 'online',
        status: 'pending',
        patientId: 'pat-new',
        suggestedPatientId: null,
        bookedByUserId: null,
        doctorId: 'doc-01',
        slotId: 'slot-01',
      });
      expect(prisma.appointmentSlot.update).toHaveBeenCalledWith({ where: { slotId: 'slot-01' }, data: { status: 'full' } });
      expect(otpStore.delete).toHaveBeenCalledWith('0901234567');
    });

    it('UTCID02 [N]: guest matches an existing MAIN patient -> suggestedPatientId set, patientId null (receptionist syncs later)', async () => {
      prisma.patient.findMany.mockResolvedValue([
        { patientId: 'pat-main', phoneNumber: '0901234567', email: null, fullName: 'nguyen  ba anh nguyen', status: 'main' },
      ]);

      const result = await service.verifyOtp(verifyDto);

      expect(result).toMatchObject({ patientId: null, suggestedPatientId: 'pat-main', suggestedReason: 'phoneNumber' });
      expect(patientService.createDraftPatientRecord).not.toHaveBeenCalled();
    });

    it('UTCID03 [N]: guest matches an existing DRAFT patient -> that draft is reused, no duplicate created', async () => {
      prisma.patient.findMany.mockResolvedValue([
        { patientId: 'pat-draft', phoneNumber: '0901234567', email: 'guest@mail.vn', fullName: 'Nguyen Ba Anh Nguyen', status: 'draft' },
      ]);

      const result = await service.verifyOtp(verifyDto);

      expect(result).toMatchObject({ patientId: 'pat-draft', suggestedPatientId: null });
      expect(patientService.createDraftPatientRecord).not.toHaveBeenCalled();
    });

    it('UTCID04 [A]: no pending request for this phone -> BadRequestException', async () => {
      otpStore.find.mockResolvedValue(null);

      await expect(service.verifyOtp(verifyDto)).rejects.toThrow(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('UTCID05 [A]: WRONG OTP -> 401, attempt counter +1, no Appointment, no Patient, slot untouched (DS-02 step 2)', async () => {
      await expect(service.verifyOtp({ ...verifyDto, otp: '000000' })).rejects.toThrow(UnauthorizedException);

      expect(otpStore.incrementAttempts).toHaveBeenCalledWith('0901234567');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.appointment.create).not.toHaveBeenCalled();
      expect(patientService.createDraftPatientRecord).not.toHaveBeenCalled();
      expect(prisma.appointmentSlot.updateMany).not.toHaveBeenCalled();
      expect(otpStore.delete).not.toHaveBeenCalled();
    });

    it('UTCID06 [A]: expired OTP -> BadRequestException and pending request removed', async () => {
      otpStore.find.mockResolvedValue(pending({ otpExpiresAt: new Date(Date.now() - 1000) }));

      await expect(service.verifyOtp(verifyDto)).rejects.toThrow(BadRequestException);
      expect(otpStore.delete).toHaveBeenCalledWith('0901234567');
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });

    it('UTCID07 [B]: attempts = 5 (limit reached) -> blocked even with the correct OTP, request removed', async () => {
      otpStore.find.mockResolvedValue(pending({ attempts: 5 }));

      await expect(service.verifyOtp(verifyDto)).rejects.toThrow(BadRequestException);
      expect(otpStore.delete).toHaveBeenCalledWith('0901234567');
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });

    it('UTCID08 [B]: attempts = 4 with a wrong OTP is still a plain 401 (not yet locked)', async () => {
      otpStore.find.mockResolvedValue(pending({ attempts: 4 }));

      await expect(service.verifyOtp({ ...verifyDto, otp: '111111' })).rejects.toThrow(UnauthorizedException);
      expect(otpStore.incrementAttempts).toHaveBeenCalled();
    });

    it('UTCID09 [A]: email differing from the one used to request the OTP is rejected', async () => {
      await expect(service.verifyOtp({ ...verifyDto, email: 'other@mail.vn' })).rejects.toThrow(BadRequestException);
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });

    it('UTCID10 [A]: slot got full between request-otp and verify-otp -> BadRequestException, no records', async () => {
      prisma.appointmentSlot.findUnique.mockResolvedValue(makeSlot({ status: 'full', bookedCount: 1 }));

      await expect(service.verifyOtp(verifyDto)).rejects.toThrow(BadRequestException);
      expect(prisma.appointment.create).not.toHaveBeenCalled();
    });

    it('UTCID11 [A]: lost the race inside the transaction (updateMany count 0) -> ConflictException, OTP kept', async () => {
      prisma.appointmentSlot.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.verifyOtp(verifyDto)).rejects.toThrow(ConflictException);
      expect(otpStore.delete).not.toHaveBeenCalled();
    });
  });
});
