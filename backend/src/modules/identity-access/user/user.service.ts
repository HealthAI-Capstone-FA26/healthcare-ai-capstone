import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { UserResponseDto } from './dto/user-response.dto';

interface CreateVerifiedUserInput {
  email: string;
  passwordHash: string;
  roleId: string; // bắt buộc: User.roleId là cột NOT NULL
  fullName: string;
  phoneNumber?: string | null;
  avatarUrl?: string | null;
}

type TxClient = PrismaService | Prisma.TransactionClient;


@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) { }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
      include: {
        profile: true,
        role: true,
      },
    });
  }

  findById(userId: string) {
    return this.prisma.user.findUnique({ where: { userId } });
  }

  // Đăng nhập sai -> tăng failedLoginAttempts, nếu chạm max thì khóa tài khoản trong lockoutDurationMins
  async registerFailedLogin(userId: string, maxLoginAttempts: number, lockoutDurationMins: number) {
    const user = await this.prisma.user.update({
      where: { userId },
      data: { failedLoginAttempts: { increment: 1 } },
    });

    if (user.failedLoginAttempts >= maxLoginAttempts) {
      const lockedUntil = new Date(Date.now() + lockoutDurationMins * 60_000);
      return this.prisma.user.update({
        where: { userId },
        data: { failedLoginAttempts: 0, lockedUntil },
      });
    }

    return user;
  }

  // Nhập đúng mật khẩu (bước 1) -> reset đếm sai / mở khóa, chưa tính là "đăng nhập" (còn chờ OTP bước 2)
  resetFailedAttempts(userId: string) {
    return this.prisma.user.update({
      where: { userId },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });
  }

  // Xác thực OTP bước 2 thành công -> ghi nhận thời điểm đăng nhập
  touchLastLogin(userId: string) {
    return this.prisma.user.update({
      where: { userId },
      data: { lastLoginAt: new Date() },
    });
  }

  updatePassword(userId: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { userId },
      data: { passwordHash },
    });
  }

  findDefaultRole() {
    return this.prisma.role.findFirst({ where: { isDefaultRole: true } });
  }

  findByIdWithPermissions(userId: string) {
    return this.prisma.user.findUnique({
      where: { userId },
      include: {
        role: {
          include: {
            rolePermissions: {
              include: { permission: true },
            },
          },
        },
      },
    });
  }

  createVerifiedUser(input: CreateVerifiedUserInput, tx: TxClient = this.prisma) {
    return tx.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        status: 'active',
        emailVerified: true,
        mfaEnabled: true,
        roleId: input.roleId, // schema v2: mỗi user có đúng 1 role ngay trên cột roleId
        profile: { // kết hợp tạo lun profile
          create: {
            fullName: input.fullName,
            phoneNumber: input.phoneNumber,
            avatarUrl: input.avatarUrl,
          },
        },
      },
    });
  }

  // Role.roleCode viết thường theo schema v2 (vd 'cardiologist') nên so khớp không phân biệt hoa/thường
  findRoleByCode(roleCode: string) {
    return this.prisma.role.findFirst({
      where: { roleCode: { equals: roleCode.trim(), mode: 'insensitive' } },
    });
  }

  toResponseDto(user: any): UserResponseDto {
    const assignedRole = user.role?.roleCode?.trim() || 'PATIENT';
    return new UserResponseDto({
      userId: user.userId,
      email: user.email,
      status: user.status,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      createdAt: user.createdAt,
      fullName: user.profile?.fullName || user.email,
      actorRole: assignedRole,
      avatarUrl: user.profile?.avatarUrl,
      phoneNumber: user.profile?.phoneNumber,
    });
  }
}
