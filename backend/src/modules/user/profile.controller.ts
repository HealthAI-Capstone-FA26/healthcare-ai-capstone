import {
    Body,
    Controller,
    Get,
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
import { RequestUser } from 'src/modules/auth/strategies/jwt.strategy';
import { imageUploadConfig } from '../../common/configs/upload.config'; // Nhớ trỏ đúng file minio config của bạn

@ApiTags('Users')
@Controller('users')
export class ProfileController {
    constructor(
        private readonly profileService: ProfileService,
    ) { }

    @Get('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Lấy profile của người dùng hiện tại',
    })
    async getMyProfile(@CurrentUser() user: RequestUser) {
        return this.profileService.findByUserId(user.userId);
    }

    @Patch('me')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiConsumes('multipart/form-data')
    @UseInterceptors(FileInterceptor('file', imageUploadConfig))
    @ApiOperation({
        summary: 'Cập nhật profile của người dùng hiện tại',
    })
    async updateMyProfile(
        @CurrentUser() user: RequestUser,
        @Body() updateProfileDto: UpdateProfileDto,
        @UploadedFile() file?: Express.Multer.File,
    ) {
        const userId = user.userId;

        return this.profileService.updateByUserId(
            userId,
            updateProfileDto,
            file,
        );
    }

    @Get(':userId')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth()
    @ApiOperation({
        summary: 'Lấy profile theo userId',
    })
    async getProfileByUserId(@Param('userId') userId: string) {
        return this.profileService.findByUserId(userId);
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