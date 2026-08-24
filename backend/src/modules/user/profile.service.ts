import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { uploadImageToS3, deleteFileFromS3 } from '../../common/configs/upload.config'; // Trỏ đúng đường dẫn file config của bạn

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) { }

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

    return this.prisma.userProfile.update({
      where: { userId },
      data: {
        ...updateProfileDto,
        avatarUrl,
      },
    });
  }
}