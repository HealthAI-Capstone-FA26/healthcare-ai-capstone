import { Controller, Get, Param } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { LabRoomService } from './lab-room.service';

@ApiTags('Lab Rooms')
@Controller('lab-rooms')
export class LabRoomController {
    constructor(private readonly labRoomService: LabRoomService) {}

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
}
