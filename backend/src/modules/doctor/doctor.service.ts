import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { generateUniqueCode } from '../../common/utils/code-generator.util';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { SearchDoctorDto } from './dto/search-doctor.dto';

const DOCTOR_CODE_PREFIX = 'BS';

@Injectable()
export class DoctorService {
  constructor(private readonly prisma: PrismaService) {}

  private generateDoctorCode(): Promise<string> {
    return generateUniqueCode(DOCTOR_CODE_PREFIX, async (code) => {
      const existing = await this.prisma.doctor.findUnique({ where: { doctorCode: code } });
      return !!existing;
    });
  }

  async create(dto: CreateDoctorDto) {
    const doctorCode = await this.generateDoctorCode();

    return this.prisma.doctor.create({
      data: {
        doctorCode,
        fullName: dto.fullName,
        title: dto.title,
        licenseNumber: dto.licenseNumber,
        specialization: dto.specialization,
        userId: dto.userId,
        isActive: dto.isActive ?? true,
      },
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
