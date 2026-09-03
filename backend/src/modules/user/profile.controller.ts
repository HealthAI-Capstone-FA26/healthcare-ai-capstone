import {
    Body,
    Controller,
    Get,
    Param,
    Patch,
    Query,
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
import { SearchUserDto } from './dto/search-user.dto';
import { JwtAuthGuard } from 'src/common/guards/jwt-auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { imageUploadConfig } from '../../common/configs/upload.config';

@ApiTags('Users')
@Controller('users')
export class ProfileController {
    constructor(
        private readonly profileService: ProfileService,
    ) { }

    @Get()
    @ApiOperation({
        summary: 'Lấy danh sách người dùng toàn hệ thống (Dành cho Admin)',
    })
    async findAll(@Query() query: SearchUserDto) {
        return this.profileService.findAll(query);
    }

    @Get(':userId')
    @ApiOperation({
        summary: 'Xem chi tiết hồ sơ tài khoản người dùng theo userId',
    })
    async findById(@Param('userId') userId: string) {
        return this.profileService.findById(userId);
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