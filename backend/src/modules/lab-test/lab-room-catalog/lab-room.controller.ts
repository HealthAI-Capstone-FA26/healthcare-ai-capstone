import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiCreatedResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { LabRoomService } from './lab-room.service';
import { AssignLabStaffToRoomDto } from './dtos/assign-lab-staff-to-room.dto';

@ApiTags('Lab Rooms')
@Controller('lab-rooms')
export class LabRoomController {
    constructor(private readonly labRoomService: LabRoomService) { }

    /**
     * GET /lab-rooms
     * Danh mục phòng Lab đang active — dùng để dựng bộ lọc worklist theo phòng
     * trên giao diện kỹ thuật viên/điều phối.
     */
    @Get()
    @ApiOperation({
        summary: 'Danh mục phòng Lab',
        description: 'Trả về danh sách các phòng Lab (Huyết học, Sinh hoá, CĐHA, ...) đang active.',
    })
    @ApiOkResponse({ description: 'Danh sách phòng Lab đang active.' })
    async list() {
        return this.labRoomService.listActive();
    }

    /**
     * GET /lab-rooms/:id/staff
     * Danh sách kỹ thuật viên được phân công vào 1 phòng Lab — dùng khi điều phối
     * cần gán nhiệm vụ (chỉ được chọn trong danh sách này).
     */
    @Get(':id/staff')
    @ApiOperation({
        summary: 'Kỹ thuật viên được phân công vào 1 phòng Lab',
        description: 'Trả về danh sách kỹ thuật viên (LabStaffRoomAssignment) thuộc phòng Lab tương ứng.',
    })
    @ApiParam({ name: 'id', description: 'ID phòng Lab (labRoomId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách phân công kỹ thuật viên của phòng.' })
    async staff(@Param('id') id: string) {
        return this.labRoomService.listStaffAssignments(id);
    }

    /**
     * POST /lab-rooms/:id/staff
     * Thêm (phân công) 1 kỹ thuật viên vào phòng Lab — kỹ thuật viên chỉ được nhận/gán
     * LabTask của các phòng mà mình có mặt trong danh sách này (xem LabRoomService.isStaffAssignedToRoom,
     * dùng làm guard ở LabTaskService.assign/receive).
     */
    @Post(':id/staff')
    @ApiOperation({
        summary: 'Thêm kỹ thuật viên vào phòng Lab',
        description: 'Idempotent — gọi lại với cùng userId sẽ cập nhật isPrimary thay vì báo lỗi trùng.',
    })
    @ApiParam({ name: 'id', description: 'ID phòng Lab (labRoomId)', format: 'uuid' })
    @ApiCreatedResponse({ description: 'Bản ghi phân công đã tạo/cập nhật.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy phòng Lab.' })
    async addStaff(@Param('id') id: string, @Body() dto: AssignLabStaffToRoomDto) {
        return this.labRoomService.assignStaff(id, dto);
    }

    /**
     * DELETE /lab-rooms/:id/staff/:userId
     * Gỡ 1 kỹ thuật viên khỏi phòng Lab (thu hồi quyền thao tác nhiệm vụ của phòng đó).
     */
    @Delete(':id/staff/:userId')
    @ApiOperation({ summary: 'Gỡ kỹ thuật viên khỏi phòng Lab' })
    @ApiParam({ name: 'id', description: 'ID phòng Lab (labRoomId)', format: 'uuid' })
    @ApiParam({ name: 'userId', description: 'ID kỹ thuật viên cần gỡ', format: 'uuid' })
    @ApiOkResponse({ description: 'Đã gỡ phân công.' })
    @ApiNotFoundResponse({ description: 'Kỹ thuật viên chưa được phân công vào phòng Lab này.' })
    async removeStaff(@Param('id') id: string, @Param('userId') userId: string) {
        return this.labRoomService.removeStaff(id, userId);
    }
}
