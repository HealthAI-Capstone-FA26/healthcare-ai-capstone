import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DoctorScheduleService } from '../../src/modules/patient-flow/doctor-schedule/doctor-schedule.service';
import { ScheduleSession } from '../../src/common/constants/schedule-session.constants';
import { CreateDoctorScheduleDto } from '../../src/modules/patient-flow/doctor-schedule/dto/create-doctor-schedule.dto';

describe('DoctorScheduleService - create (Function 11)', () => {
  let service: DoctorScheduleService;
  let mockPrisma: any;
  let mockAppointmentSlotService: any;

  const mockDoctor = {
    doctorId: 'doc-01',
    fullName: 'BS. CKII Nguyen Van Tim',
    specialty: 'Tim mach',
    isActive: true,
  };

  beforeEach(() => {
    mockPrisma = {
      doctor: {
        findUnique: jest.fn(),
      },
      doctorSchedule: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      $transaction: jest.fn(async (callback) => {
        return callback(mockPrisma);
      }),
    };

    mockAppointmentSlotService = {
      generateSlotsForSchedule: jest.fn(),
    };

    service = new DoctorScheduleService(
      mockPrisma as any,
      mockAppointmentSlotService as any,
    );
  });

  // UTCID01 [Normal]: Tạo lịch ca Sáng thành công (07:30 - 11:30), sinh 8 slots
  it('UTCID01 [N]: should successfully create MORNING schedule and generate 8 slots', async () => {
    // Arrange
    const dto: CreateDoctorScheduleDto = {
      doctorId: 'doc-01',
      workDate: '2026-11-20',
      session: ScheduleSession.MORNING,
      startTime: '07:30',
      endTime: '11:30',
      slotDurationMins: 30,
      maxPatientsPerSlot: 1,
    };

    mockPrisma.doctor.findUnique.mockResolvedValue(mockDoctor);
    mockPrisma.doctorSchedule.findUnique.mockResolvedValue(null); // Không bị trùng lịch
    mockPrisma.doctorSchedule.create.mockResolvedValue({
      scheduleId: 'sched-01',
      doctorId: 'doc-01',
      workDate: new Date('2026-11-20T00:00:00.000Z'),
      session: ScheduleSession.MORNING,
    });
    mockAppointmentSlotService.generateSlotsForSchedule.mockResolvedValue(8);

    // Act
    const result = await service.create(dto);

    // Assert
    expect(mockPrisma.doctor.findUnique).toHaveBeenCalledWith({ where: { doctorId: 'doc-01' } });
    expect(mockPrisma.doctorSchedule.findUnique).toHaveBeenCalled();
    expect(mockAppointmentSlotService.generateSlotsForSchedule).toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result?.slotCount).toBe(8);
  });

  // UTCID02 [Normal]: Tạo lịch ca Chiều thành công (13:00 - 17:00), sinh 8 slots
  it('UTCID02 [N]: should successfully create AFTERNOON schedule and generate 8 slots', async () => {
    // Arrange
    const dto: CreateDoctorScheduleDto = {
      doctorId: 'doc-01',
      workDate: '2026-11-20',
      session: ScheduleSession.AFTERNOON,
      startTime: '13:00',
      endTime: '17:00',
      slotDurationMins: 30,
      maxPatientsPerSlot: 1,
    };

    mockPrisma.doctor.findUnique.mockResolvedValue(mockDoctor);
    mockPrisma.doctorSchedule.findUnique.mockResolvedValue(null);
    mockPrisma.doctorSchedule.create.mockResolvedValue({
      scheduleId: 'sched-02',
      doctorId: 'doc-01',
      workDate: new Date('2026-11-20T00:00:00.000Z'),
      session: ScheduleSession.AFTERNOON,
    });
    mockAppointmentSlotService.generateSlotsForSchedule.mockResolvedValue(8);

    // Act
    const result = await service.create(dto);

    // Assert
    expect(result?.slotCount).toBe(8);
    expect(result?.schedule.session).toBe(ScheduleSession.AFTERNOON);
  });

  // UTCID03 [Abnormal]: Bác sĩ không tồn tại (doc-404) -> Quăng lỗi NotFoundException
  it('UTCID03 [A]: should throw NotFoundException when doctor does not exist', async () => {
    // Arrange
    const dto: CreateDoctorScheduleDto = {
      doctorId: 'doc-404',
      workDate: '2026-11-20',
      session: ScheduleSession.MORNING,
    };

    mockPrisma.doctor.findUnique.mockResolvedValue(null); // Không tìm thấy bác sĩ

    // Act & Assert
    await expect(service.create(dto)).rejects.toThrow(NotFoundException);
    expect(mockPrisma.doctorSchedule.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.doctorSchedule.create).not.toHaveBeenCalled();
  });

  // UTCID04 [Abnormal]: Bác sĩ đã có lịch trực ca này -> Quăng lỗi ConflictException
  it('UTCID04 [A]: should throw ConflictException if doctor already has schedule for this date & session', async () => {
    // Arrange
    const dto: CreateDoctorScheduleDto = {
      doctorId: 'doc-01',
      workDate: '2026-11-20',
      session: ScheduleSession.MORNING,
    };

    mockPrisma.doctor.findUnique.mockResolvedValue(mockDoctor);
    // Giả lập đã tồn tại lịch khám trùng
    mockPrisma.doctorSchedule.findUnique.mockResolvedValue({
      scheduleId: 'sched-existing',
      doctorId: 'doc-01',
      session: ScheduleSession.MORNING,
    });

    // Act & Assert
    await expect(service.create(dto)).rejects.toThrow(ConflictException);
    expect(mockPrisma.doctorSchedule.create).not.toHaveBeenCalled();
  });

  // UTCID05 [Abnormal]: startTime >= endTime -> Quăng lỗi BadRequestException
  it('UTCID05 [A]: should throw BadRequestException if startTime >= endTime', async () => {
    // Arrange: Giờ bắt đầu muộn hơn giờ kết thúc (vô lý)
    const dto: CreateDoctorScheduleDto = {
      doctorId: 'doc-01',
      workDate: '2026-11-20',
      session: ScheduleSession.MORNING,
      startTime: '11:30',
      endTime: '07:30',
    };

    mockPrisma.doctor.findUnique.mockResolvedValue(mockDoctor);

    // Act & Assert
    await expect(service.create(dto)).rejects.toThrow(BadRequestException);
    expect(mockPrisma.doctorSchedule.create).not.toHaveBeenCalled();
  });

  // UTCID06 [Boundary]: Tạo lịch cho ngày mai (ngưỡng sớm nhất hợp lệ)
  it('UTCID06 [B]: should allow creating schedule for tomorrow (boundary valid advance date)', async () => {
    // Arrange: Tạo mốc ngày mai
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().split('T')[0];

    const dto: CreateDoctorScheduleDto = {
      doctorId: 'doc-01',
      workDate: tomorrowStr,
      session: ScheduleSession.MORNING,
    };

    mockPrisma.doctor.findUnique.mockResolvedValue(mockDoctor);
    mockPrisma.doctorSchedule.findUnique.mockResolvedValue(null);
    mockPrisma.doctorSchedule.create.mockResolvedValue({
      scheduleId: 'sched-03',
      doctorId: 'doc-01',
      workDate: new Date(`${tomorrowStr}T00:00:00.000Z`),
      session: ScheduleSession.MORNING,
    });
    mockAppointmentSlotService.generateSlotsForSchedule.mockResolvedValue(8);

    // Act
    const result = await service.create(dto);

    // Assert
    expect(result).toBeDefined();
    expect(mockPrisma.doctorSchedule.create).toHaveBeenCalled();
  });
});
