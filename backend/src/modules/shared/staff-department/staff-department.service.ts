import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { ActorRoleService } from '../../user/actor-role.service';
import { AssignStaffDepartmentDto } from './dto/assign-staff-department.dto';

export function encodeStaffDepartmentId(userId: string, departmentId: string): string {
  return `${userId}_${departmentId}`;
}

function decodeStaffDepartmentId(id: string): { userId: string; departmentId: string } {
  const [userId, departmentId] = id.split('_');
  if (!userId || !departmentId) {
    throw new BadRequestException('id không hợp lệ, định dạng đúng là "userId_departmentId"');
  }
  return { userId, departmentId };
}

@Injectable()
export class StaffDepartmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly actorRoleService: ActorRoleService,
  ) {}

  async assign(userId: string, dto: AssignStaffDepartmentDto) {
    const user = await this.prisma.user.findUnique({ where: { userId } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy nhân viên');
    }

    await this.actorRoleService.assertActorRole(userId, [ACTOR_ROLE.NURSE]);

    const department = await this.prisma.department.findUnique({
      where: { departmentId: dto.departmentId },
    });
    if (!department) {
      throw new NotFoundException('Không tìm thấy khoa');
    }

    const isPrimary = dto.isPrimary ?? true;

    return this.prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.staffDepartment.updateMany({
          where: { userId },
          data: { isPrimary: false },
        });
      }

      const staffDepartment = await tx.staffDepartment.upsert({
        where: { userId_departmentId: { userId, departmentId: dto.departmentId } },
        create: { userId, departmentId: dto.departmentId, isPrimary },
        update: { isPrimary },
        include: { user: { include: { profile: true } }, department: true },
      });

      return {
        ...staffDepartment,
        id: encodeStaffDepartmentId(userId, dto.departmentId),
      };
    });
  }

  async updatePrimary(id: string, isPrimary: boolean) {
    const { userId, departmentId } = decodeStaffDepartmentId(id);
    const existing = await this.prisma.staffDepartment.findUnique({
      where: { userId_departmentId: { userId, departmentId } },
    });
    if (!existing) {
      throw new NotFoundException('Không tìm thấy liên kết nhân viên - khoa');
    }

    return this.prisma.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.staffDepartment.updateMany({
          where: { userId },
          data: { isPrimary: false },
        });
      }

      return tx.staffDepartment.update({
        where: { userId_departmentId: { userId, departmentId } },
        data: { isPrimary },
        include: { user: { include: { profile: true } }, department: true },
      });
    });
  }

  async remove(id: string) {
    const { userId, departmentId } = decodeStaffDepartmentId(id);
    const existing = await this.prisma.staffDepartment.findUnique({
      where: { userId_departmentId: { userId, departmentId } },
    });
    if (!existing) {
      throw new NotFoundException('Không tìm thấy liên kết nhân viên - khoa');
    }

    await this.prisma.staffDepartment.delete({
      where: { userId_departmentId: { userId, departmentId } },
    });

    return { message: 'Đã gỡ nhân viên khỏi khoa' };
  }

  async findStaffByDepartment(departmentId: string) {
    const department = await this.prisma.department.findUnique({ where: { departmentId } });
    if (!department) {
      throw new NotFoundException('Không tìm thấy khoa');
    }

    return this.prisma.staffDepartment.findMany({
      where: { departmentId },
      include: { user: { include: { profile: true } }, department: true },
      orderBy: [{ isPrimary: 'desc' }, { assignedAt: 'asc' }],
    });
  }
}
