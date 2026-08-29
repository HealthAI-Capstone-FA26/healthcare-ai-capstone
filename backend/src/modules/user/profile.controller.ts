import {
    Body,
    Controller,
    Param,
    Patch,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiConsumes,
    ApiOperation,
    ApiTags,
} from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';

import { ProfileService } from './profile.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { imageUploadConfig } from '../../common/configs/upload.config'; // Nhớ trỏ đúng file minio config của bạn

@ApiTags('Users')
@Controller('users')
export class ProfileController {
    constructor(
        private readonly profileService: ProfileService,
    ) { }

    @Patch('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file', imageUploadConfig))
    @ApiOperation({
        summary: 'Cập nhật profile của người dùng hiện tại',
    })
    async updateMyProfile(
        @CurrentUser('userId') userId: string,
        @Body() updateProfileDto: UpdateProfileDto,
        @UploadedFile() file?: Express.Multer.File,
    ) {
        // Loại bỏ actorRole nếu user cố tình gửi lên trong body
        const { actorRole, ...safeUpdateDto } = updateProfileDto;

        return this.profileService.updateByUserId(
            userId,
            safeUpdateDto,
            file,
        );
    }

    @Patch(':userId')
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file', imageUploadConfig))
    @ApiOperation({
        summary: 'Cập nhật profile theo userId',
        description: 'Dành cho Admin',
    })
    async updateByUserId(
        @Param('userId') userId: string,
        @Body() updateProfileDto: UpdateProfileDto,
        @UploadedFile() file?: Express.Multer.File,
    ) {
        return this.profileService.updateByUserId(
            userId,
            updateProfileDto,
            file,
        );
    }
}