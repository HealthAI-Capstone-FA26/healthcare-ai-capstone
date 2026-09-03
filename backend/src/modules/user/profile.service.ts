import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SearchUserDto } from './dto/search-user.dto';
import { uploadImageToS3, deleteFileFromS3 } from '../../common/configs/upload.config';

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) { }

  async findAll(query?: SearchUserDto) {
    const where: any = {};

    if (query?.actorRole && query.actorRole !== 'ALL') {
      where.profile = {
        actorRole: { equals: query.actorRole, mode: 'insensitive' },
      };
    }

    if (query?.search?.trim()) {
      const term = query.search.trim();
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        {
          profile: {
            fullName: { contains: term, mode: 'insensitive' },
          },
        },
        {
          profile: {
            phoneNumber: { contains: term, mode: 'insensitive' },
          },
        },
      ];
    }

    const users = await this.prisma.user.findMany({
      where,
      include: {
        profile: true,
        userRoles: {
          include: {
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((u) => ({
      userId: u.userId,
      email: u.email,
      status: u.status,
      emailVerified: u.emailVerified,
      mfaEnabled: u.mfaEnabled,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
      lastLoginAt: u.lastLoginAt,
      profileId: u.profile?.profileId,
      fullName: u.profile?.fullName || u.email,
      phoneNumber: u.profile?.phoneNumber,
      avatarUrl: u.profile?.avatarUrl,
      actorRole: u.userRoles?.[0]?.role?.roleCode?.trim() || u.profile?.actorRole || 'PATIENT',
      additionalProfile: u.profile?.additionalProfile,
    }));
  }

  async findById(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { userId },
      include: {
        profile: true,
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return {
      userId: user.userId,
      email: user.email,
      status: user.status,
      emailVerified: user.emailVerified,
      mfaEnabled: user.mfaEnabled,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      profileId: user.profile?.profileId,
      fullName: user.profile?.fullName || user.email,
      phoneNumber: user.profile?.phoneNumber,
      avatarUrl: user.profile?.avatarUrl,
      actorRole: user.userRoles?.[0]?.role?.roleCode?.trim() || user.profile?.actorRole || 'PATIENT',
      additionalProfile: user.profile?.additionalProfile,
    };
  }

  async updateByUserId(
    userId: string,
    updateProfileDto: UpdateProfileDto,
    file?: Express.Multer.File,
  ) {
    const existingProfile = await this.prisma.userProfile.findUnique({
      where: { userId },
    });

    if (!existingProfile) {
      throw new NotFoundException(`Profile for user ID ${userId} not found`);
    }

    let avatarUrl = existingProfile.avatarUrl;

    if (file) {
      const uploadResult = await uploadImageToS3(file, 'avatars');
      avatarUrl = uploadResult.objectName; // Lưu objectName (vd: avatars/171000-1234.png)

      if (existingProfile.avatarUrl) {
        await deleteFileFromS3(existingProfile.avatarUrl);
      }
    }

    const { avatar, ...updateData } = updateProfileDto;

    const updatedProfile = await this.prisma.userProfile.update({
      where: { userId },
      data: {
        ...updateData,
        avatarUrl,
      },
    });

    // Đồng bộ sang bảng Doctor nếu user này liên kết với hồ sơ Bác sĩ và có cập nhật fullName
    if (updateData.fullName) {
      await this.prisma.doctor.updateMany({
        where: { userId },
        data: { fullName: updateData.fullName },
      });
    }

    return updatedProfile;
  }
}