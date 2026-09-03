import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { AssignDoctorDepartmentDto } from './dto/assign-doctor-department.dto';

// Schema dùng composite PK (doctorId, departmentId) cho DoctorDepartment (không có id riêng).
// Để giữ đúng route dạng `/doctor-departments/:id` như spec, ta encode composite key thành
// chuỗi "doctorId_departmentId" (UUID dùng dấu gạch ngang nên gạch dưới an toàn làm separator).
export function encodeDoctorDepartmentId(doctorId: string, departmentId: string): string {
  return `${doctorId}_${departmentId}`;
}

function decodeDoctorDepartmentId(id: string): { doctorId: string; departmentId: string } {
  const [doctorId, departmentId] = id.split('_');
  if (!doctorId || !departmentId) {
    throw new BadRequestException('id không hợp lệ, định dạng đúng là "doctorId_departmentId"');
  }
  return { doctorId, departmentId };
}

@Injectable()
export class DoctorDepartmentService {
  constructor(private readonly prisma: PrismaService) { }

  async assign(doctorId: string, dto: AssignDoctorDepartmentDto) {
    const doctor = await this.prisma.doctor.findUnique({ where: { doctorId } });
    if (!doctor) {
      throw new NotFoundException('Không tìm thấy bác sĩ');
    }

    const department = await this.prisma.department.findUnique({
      where: { departmentId: dto.departmentId },
    });
    if (!department) {
      throw new NotFoundException('Không tìm thấy khoa');
    }

    const isPrimary = dto.isPrimary ?? true;

    return this.prisma.$transaction(async (tx) => {
      if (isPrimary) {
        // Chỉ 1 khoa được isPrimary = true tại một thời điểm cho mỗi doctor
        await tx.doctorDepartment.updateMany({
          where: { doctorId },
          data: { isPrimary: false },
        });
      }

      return tx.doctorDepartment.upsert({
        where: { doctorId_departmentId: { doctorId, departmentId: dto.departmentId } },
        create: { doctorId, departmentId: dto.departmentId, isPrimary },
        update: { isPrimary },
        include: { department: true },
      }).then((doctorDepartment) => ({
        ...doctorDepartment,
        id: encodeDoctorDepartmentId(doctorId, dto.departmentId),
      }));
    });
  }

  async updatePrimary(id: string, isPrimary: boolean) {
    const { doctorId, departmentId } = decodeDoctorDepartmentId(id);

    const existing = await this.prisma.doctorDepartment.findUnique({
      where: { doctorId_departmentId: { doctorId, departmentId } },
    });
    if (!existing) {
      throw new NotFoundException('Không tìm thấy liên kết bác sĩ - khoa');
    }

    return this.prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.doctorDepartment.updateMany({
          where: { doctorId },
          data: { isPrimary: false },
        });
      }

      return tx.doctorDepartment.update({
        where: { doctorId_departmentId: { doctorId, departmentId } },
        data: { isPrimary },
      });
    });
  }

  async remove(id: string) {
    const { doctorId, departmentId } = decodeDoctorDepartmentId(id);

    const existing = await this.prisma.doctorDepartment.findUnique({
      where: { doctorId_departmentId: { doctorId, departmentId } },
    });
    if (!existing) {
      throw new NotFoundException('Không tìm thấy liên kết bác sĩ - khoa');
    }

    await this.prisma.doctorDepartment.delete({
      where: { doctorId_departmentId: { doctorId, departmentId } },
    });

    return { message: 'Đã gỡ bác sĩ khỏi khoa' };
  }

  // GET /departments/:id/doctors — dùng ở bước 2 luồng đặt lịch online
  async findDoctorsByDepartment(departmentId: string) {
    const department = await this.prisma.department.findUnique({ where: { departmentId } });
    if (!department) {
      throw new NotFoundException('Không tìm thấy khoa');
    }

    return this.prisma.doctorDepartment.findMany({
      where: { departmentId, doctor: { isActive: true } },
      include: { doctor: true },
      orderBy: [{ isPrimary: 'desc' }],
    });
  }

  // GET /departments — lấy danh sách tất cả các khoa phòng đang hoạt động
  findAllDepartments() {
    return this.prisma.department.findMany({
      where: { isActive: true },
      orderBy: { departmentName: 'asc' },
    });
  }
}
