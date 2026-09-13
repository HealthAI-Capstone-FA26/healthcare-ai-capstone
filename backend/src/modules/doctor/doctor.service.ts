import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { generateUniqueCode } from '../../common/utils/code-generator.util';
import { SALT_ROUNDS } from '../auth/common/auth.constants';
import { ACTOR_ROLE } from '../../common/constants/actor-role.constant';
import { UserService } from '../user/user.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { SearchDoctorDto } from './dto/search-doctor.dto';

const DOCTOR_CODE_PREFIX = 'BS';
// FIX: dùng hằng số dùng chung thay vì hardcode 'DOCTOR' cục bộ — tránh lệch giá trị
// nếu sau này Role.roleCode của bác sĩ đổi tên (chỉ cần sửa 1 chỗ ở actor-role.constant.ts).
const DOCTOR_ROLE_CODE = ACTOR_ROLE.DOCTOR;

@Injectable()
export class DoctorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
  ) { }

  private generateDoctorCode(): Promise<string> {
    return generateUniqueCode(DOCTOR_CODE_PREFIX, async (code) => {
      const existing = await this.prisma.doctor.findUnique({ where: { doctorCode: code } });
      return !!existing;
    });
  }

  async create(dto: CreateDoctorDto) {
    const doctorCode = await this.generateDoctorCode();

    // Bác sĩ thỉnh giảng (không có email) -> chỉ tạo bản ghi doctor, userId để null.
    if (!dto.email) {
      return this.prisma.doctor.create({
        data: {
          doctorCode,
          fullName: dto.fullName,
          title: dto.title,
          licenseNumber: dto.licenseNumber,
          specialization: dto.specialization,
          isActive: dto.isActive ?? true,
        },
      });
    }

    // Bác sĩ chính thức -> tạo đồng thời User (role DOCTOR) + Doctor, gán userId cho doctor.
    const existingUser = await this.userService.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('Email đã được sử dụng');
    }

    const doctorRole = await this.userService.findRoleByCode(DOCTOR_ROLE_CODE);
    const passwordHash = await bcrypt.hash(dto.password as string, SALT_ROUNDS);

    return this.prisma.$transaction(async (tx) => {
      const user = await this.userService.createVerifiedUser(
        {
          email: dto.email as string,
          passwordHash,
          actorRole: DOCTOR_ROLE_CODE,
          fullName: dto.fullName,
          phoneNumber: dto.phoneNumber,
          defaultRoleId: doctorRole?.roleId,
        },
        tx,
      );

      return tx.doctor.create({
        data: {
          doctorCode,
          fullName: dto.fullName,
          title: dto.title,
          licenseNumber: dto.licenseNumber,
          specialization: dto.specialization,
          userId: user.userId, // gán userId vừa tạo cho doctor
          isActive: dto.isActive ?? true,
        },
      });
    });
  }

  async findById(doctorId: string) {
    const doctor = await this.prisma.doctor.findUnique({
      where: { doctorId },
      include: { doctorDepartments: { include: { department: true } } },
    });

    if (!doctor) {
      throw new NotFoundException('Không tìm thấy bác sĩ');
    }
    return doctor;
  }

  // Resolve Doctor record từ userId đang đăng nhập (JWT chỉ có userId, không có doctorId sẵn) —
  // dùng khi 1 module khác (vd: Prescription) cần biết "bác sĩ hiện tại" ứng với request.user.
  async findByUserId(userId: string) {
    const doctor = await this.prisma.doctor.findUnique({ where: { userId } });

    if (!doctor) {
      throw new NotFoundException('Tài khoản hiện tại không gắn với hồ sơ bác sĩ nào');
    }
    return doctor;
  }

  findAll(query: SearchDoctorDto) {
    const where: Prisma.DoctorWhereInput = {};

    if (query.search) {
      where.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { doctorCode: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    if (query.departmentId) {
      where.doctorDepartments = { some: { departmentId: query.departmentId } };
    }

    return this.prisma.doctor.findMany({
      where,
      include: { doctorDepartments: { include: { department: true } } },
      orderBy: { fullName: 'asc' },
    });
  }

  async update(doctorId: string, dto: UpdateDoctorDto) {
    await this.findById(doctorId);

    return this.prisma.doctor.update({
      where: { doctorId },
      data: dto,
    });
  }
}