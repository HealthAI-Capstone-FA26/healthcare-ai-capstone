import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma/prisma.service';
import { generateUniqueCode } from '../../common/utils/code-generator.util';
import { SALT_ROUNDS } from '../auth/common/auth.constants';
import { ACTOR_ROLE, PRIMARY_ROLE_CODE } from '../../common/constants/actor-role.constant';
import { UserService } from '../user/user.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { SearchDoctorDto } from './dto/search-doctor.dto';

const DOCTOR_CODE_PREFIX = 'BS';
// FIX: dùng hằng số dùng chung thay vì hardcode 'DOCTOR' cục bộ — tránh lệch giá trị
// nếu sau này Role.roleCode của bác sĩ đổi tên (chỉ cần sửa 1 chỗ ở actor-role.constant.ts).
const DOCTOR_ROLE_CODE = PRIMARY_ROLE_CODE[ACTOR_ROLE.DOCTOR]; // 'cardiologist' (Role.roleCode schema v2)

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
    // Schema v2: Doctor.userId là NOT NULL (1-1 với User) nên bác sĩ nào cũng cần tài khoản đăng nhập.
    if (!dto.email || !dto.password) {
      throw new BadRequestException('Cần truyền email và password để tạo tài khoản cho bác sĩ');
    }

    const doctorCode = await this.generateDoctorCode();

    const existingUser = await this.userService.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('Email đã được sử dụng');
    }

    const doctorRole = await this.userService.findRoleByCode(DOCTOR_ROLE_CODE);
    if (!doctorRole) {
      throw new NotFoundException(`Chưa cấu hình role '${DOCTOR_ROLE_CODE}' trong hệ thống`);
    }
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);

    return this.prisma.$transaction(async (tx) => {
      const user = await this.userService.createVerifiedUser(
        {
          email: dto.email as string,
          passwordHash,
          roleId: doctorRole.roleId,
          fullName: dto.fullName,
          phoneNumber: dto.phoneNumber,
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
    });

    if (!doctor) {
      throw new NotFoundException('Không tìm thấy bác sĩ');
    }
    return doctor;
  }

  /**
   * Suy ra bản ghi Doctor (doctorId — khoá dùng bởi ClinicalExamination/TreatmentConsultation...)
   * từ userId lấy trên JWT (@CurrentUser). Dùng bởi các module khám bệnh (Module 5, 8) thay vì
   * mỗi module tự query `prisma.doctor.findUnique({ where: { userId } })` rải rác.
   */
  async findByUserId(userId: string) {
    const doctor = await this.prisma.doctor.findUnique({ where: { userId } });
    if (!doctor) {
      throw new NotFoundException(`Không tìm thấy hồ sơ bác sĩ ứng với user ${userId}`);
    }
    return doctor;
  }

  findAll(query: SearchDoctorDto) {
    const where: Prisma.DoctorWhereInput = {};

    // Lọc theo userId — dùng để tra doctorId sau khi bác sĩ đăng nhập
    if (query.userId) {
      where.userId = query.userId;
    }

    if (query.search) {
      where.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { doctorCode: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.doctor.findMany({
      where,
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