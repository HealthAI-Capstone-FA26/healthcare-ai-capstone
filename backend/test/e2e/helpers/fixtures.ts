import { INestApplication } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { ACTOR_ROLE, roleCodesOfActorRole } from '../../../src/common/constants/actor-role.constant';
import { toDateOnlyUTC } from '../../../src/common/constants/queue-ticket.constants';
import { getHospitalWallClockNow } from '../../../src/common/utils/hospital-clock.util';
import { signToken } from './app';

export interface E2EActor {
  userId: string;
  email: string;
  token: string;
}

export interface Fixtures {
  receptionist: E2EActor;
  nurse: E2EActor;
  doctor: E2EActor & { doctorId: string };
}

const randomDigits = (length: number) =>
  Array.from(randomBytes(length), (b) => b % 10).join('');

/** Thông tin bệnh nhân mới, identityNumber/insuranceNumber/phone random để các lần chạy không đụng unique. */
export function newPatientPayload() {
  return {
    fullName: 'Nguyen Van E2E',
    dateOfBirth: '1990-05-20',
    gender: 'male',
    identityNumber: `079${randomDigits(9)}`,
    insuranceNumber: `HS4${randomDigits(12)}`,
    phoneNumber: `09${randomDigits(8)}`,
  };
}

/**
 * Dựng dữ liệu nền cho 1 workflow: lễ tân + y tá + bác sĩ (có ca trực cả ngày hôm nay theo giờ bệnh viện)
 * + biểu phí khám. Role/permission/consent policy/vital item lấy từ `prisma db seed` (CI đã chạy bước này).
 *
 * Mỗi spec dựng roster mới và "nghỉ hưu" roster của spec trước, để hàng đợi triage (chọn y tá ít việc nhất)
 * và điều phối bác sĩ (chọn bác sĩ đang trong ca) chỉ thấy đúng người của spec đang chạy.
 */
export async function seedFixtures(app: INestApplication): Promise<Fixtures> {
  const prisma = app.get(PrismaService);
  const runId = randomBytes(4).toString('hex');

  await prisma.user.updateMany({ where: { email: { startsWith: 'e2e-' } }, data: { status: 'inactive' } });
  await prisma.doctor.updateMany({ where: { doctorCode: { startsWith: 'E2E' } }, data: { isActive: false } });
  await prisma.doctorSchedule.updateMany({
    where: { doctor: { doctorCode: { startsWith: 'E2E' } } },
    data: { status: 'cancelled' },
  });

  const createActor = async (actorRole: string, label: string): Promise<E2EActor & { roleId: string }> => {
    const role = await prisma.role.findFirst({ where: { roleCode: { in: roleCodesOfActorRole(actorRole) } } });
    if (!role) {
      throw new Error(`Chưa có role ${actorRole} trong DB — cần chạy "npx prisma db seed" trước khi chạy e2e.`);
    }
    const user = await prisma.user.create({
      data: {
        email: `e2e-${label}-${runId}@example.test`,
        passwordHash: 'e2e-not-used', // token được ký trực tiếp, không đi qua login/OTP
        status: 'active',
        emailVerified: true,
        roleId: role.roleId,
      },
    });
    return { userId: user.userId, email: user.email, token: signToken(app, user), roleId: role.roleId };
  };

  const receptionist = await createActor(ACTOR_ROLE.RECEPTIONIST, 'reception');
  const nurse = await createActor(ACTOR_ROLE.NURSE, 'nurse');
  const doctorUser = await createActor(ACTOR_ROLE.DOCTOR, 'doctor');

  const doctor = await prisma.doctor.create({
    data: { userId: doctorUser.userId, doctorCode: `E2E${runId}`, fullName: 'BS E2E', isActive: true },
  });

  // Service tính "đang trong ca" theo giờ Asia/Ho_Chi_Minh -> workDate phải dùng đúng cùng cách tính.
  await prisma.doctorSchedule.create({
    data: {
      doctorId: doctor.doctorId,
      workDate: toDateOnlyUTC(getHospitalWallClockNow()),
      session: 'morning',
      startTime: new Date('1970-01-01T00:00:00.000Z'),
      endTime: new Date('1970-01-01T23:59:00.000Z'),
      slotDurationMins: 15,
      maxPatientsPerSlot: 1,
    },
  });

  // Phí khám: invoice được lập khi lễ tân bấm "done" cần 1 biểu phí standard đang hiệu lực.
  const yesterday = toDateOnlyUTC(new Date(Date.now() - 24 * 60 * 60 * 1000));
  await prisma.examinationFeeCatalog.upsert({
    where: { feeCode: 'E2E-STD-FEE' },
    update: { isActive: true, effectiveFrom: yesterday },
    create: {
      feeCode: 'E2E-STD-FEE',
      feeName: 'Phi kham E2E',
      feeType: 'standard',
      price: 150000,
      isActive: true,
      effectiveFrom: yesterday,
    },
  });

  return {
    receptionist,
    nurse,
    doctor: { userId: doctorUser.userId, email: doctorUser.email, token: doctorUser.token, doctorId: doctor.doctorId },
  };
}
