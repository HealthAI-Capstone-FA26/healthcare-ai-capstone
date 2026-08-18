import { Injectable } from '@nestjs/common';
import { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { UserResponseDto } from './dto/user-response.dto';

interface CreateVerifiedUserInput {
  email: string;
  passwordHash: string;
  actorRole: string;
  fullName: string;
  phoneNumber?: string | null;
  defaultRoleId?: string;
}

type TxClient = PrismaService | Prisma.TransactionClient;


@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) { }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } })
  }

  findDefaultRole() {
    return this.prisma.role.findFirst({ where: { isDefaultRole: true } });
  }

  findByIdWithPermissions(userId: string) {
    return this.prisma.user.findUnique({
      where: { userId },
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });
  }

  createVerifiedUser(input: CreateVerifiedUserInput, tx: TxClient = this.prisma ){
    return tx.user.create({
      data: {
        email:input.email,
        passwordHash: input.passwordHash,
        status: 'active',
        emailVerified: true,
        mfaEnabled: true, 
        profile: { // kết hợp tạo lun profile
          create: {
            actorRole: input.actorRole,
            fullName: input.fullName,
            phoneNumber: input.phoneNumber,
          },
      },
      ...(input.defaultRoleId &&{ // ở đây có nghĩa là nếu có default role thì tạo lun role
        userRoles: {
          create: {
            roleId: input.defaultRoleId
          }
        },
      }),
    },
  });
}

  toResponseDto(user: User): UserResponseDto {
    return new UserResponseDto({
      userId: user.userId,
      email: user.email,
      status: user.status,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      createdAt: user.createdAt,
    });
  }
}
