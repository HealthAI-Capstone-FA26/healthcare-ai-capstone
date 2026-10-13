import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiQuery,
    ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { LabRoomService } from './lab-room.service';
import { AssignLabStaffToRoomDto } from './dtos/assign-lab-staff-to-room.dto';

/** Toàn bộ route yêu cầu đăng nhập; gán/gỡ nhân sự chỉ ADMIN (kiểm trong service). */
@ApiTags('Lab Rooms (Diagnostic Rooms)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lab-rooms')
export class LabRoomController {
    constructor(private readonly labRoomService: LabRoomService) {}

    @Get()
    @ApiOperation({
        summary: 'Danh mục phòng cận lâm sàng đang hoạt động',
        description: 'Blood Lab / ECG / Echo / X-ray. Có thể lọc theo modality.',
    })
    @ApiQuery({ name: 'modality', required: false, enum: ['blood_test', 'ecg', 'xray', 'echo'] })
    @ApiOkResponse({ description: 'Danh sách phòng đang active.' })
    async list(@Query('modality') modality?: string) {
        return this.labRoomService.listActive(modality);
    }

    @Get('my-assignments')
    @ApiOperation({ summary: 'Danh sách phòng của KTV đang đăng nhập' })
    @ApiOkResponse({ description: 'Danh sách phân công phòng của KTV.' })
    async myAssignments(@CurrentUser('userId') userId: string) {
        return this.labRoomService.listMyAssignments(userId);
    }

    @Get(':id/staff')
    @ApiOperation({ summary: 'Kỹ thuật viên được phân công vào 1 phòng' })
    @ApiParam({ name: 'id', description: 'ID phòng (diagnosticRoomId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách phân công kỹ thuật viên của phòng.' })
    async staff(@Param('id') id: string) {
        return this.labRoomService.listStaffAssignments(id);
    }

    @Post(':id/staff')
    @ApiOperation({ summary: 'Phân công kỹ thuật viên vào phòng (ADMIN)' })
    @ApiParam({ name: 'id', description: 'ID phòng (diagnosticRoomId)', format: 'uuid' })
    @ApiCreatedResponse({ description: 'Bản ghi phân công sau khi tạo/cập nhật.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy phòng hoặc người dùng.' })
    @ApiForbiddenResponse({ description: 'Người gọi không phải ADMIN.' })
    async assignStaff(
        @Param('id') id: string,
        @Body() dto: AssignLabStaffToRoomDto,
        @CurrentUser('userId') actingUserId: string,
    ) {
        return this.labRoomService.assignStaff(id, dto, actingUserId);
    }

    @Delete(':id/staff/:userId')
    @ApiOperation({ summary: 'Gỡ kỹ thuật viên khỏi phòng (ADMIN)' })
    @ApiParam({ name: 'id', description: 'ID phòng (diagnosticRoomId)', format: 'uuid' })
    @ApiParam({ name: 'userId', description: 'ID kỹ thuật viên', format: 'uuid' })
    @ApiForbiddenResponse({ description: 'Người gọi không phải ADMIN.' })
    async removeStaff(
        @Param('id') id: string,
        @Param('userId') userId: string,
        @CurrentUser('userId') actingUserId: string,
    ) {
        return this.labRoomService.removeStaff(id, userId, actingUserId);
    }
}
