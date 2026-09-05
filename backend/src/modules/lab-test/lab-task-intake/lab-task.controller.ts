import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
    ApiForbiddenResponse,
    ApiBadRequestResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { LabTaskService } from './lab-task.service';
import { ListLabTasksQueryDto } from './dtos/list-lab-tasks-query.dto';
import { AssignLabTaskDto } from './dtos/assign-lab-task.dto';
import { ReceiveLabTaskDto } from './dtos/receive-lab-task.dto';
import { CancelLabTaskDto } from './dtos/cancel-lab-task.dto';

/**
 * Tiếp nhận & vòng đời nhiệm vụ xét nghiệm (LabTask), do Kỹ thuật viên phòng Lab thao tác.
 * TODO: gắn Guard role LAB_STAFF + kiểm tra req.user thuộc đúng labRoomId khi có auth module.
 */
@ApiTags('Lab Tasks')
@Controller('lab-tasks')
export class LabTaskController {
    constructor(private readonly labTaskService: LabTaskService) {}

    /**
     * GET /lab-tasks?labRoomId=...&status=...&assignedLabStaffId=...
     * Worklist của 1 phòng Lab — bắt buộc lọc theo labRoomId vì kỹ thuật viên chỉ được
     * xem/thao tác trong phạm vi phòng chuyên môn mình phụ trách.
     */
    @Get()
    @ApiOperation({
        summary: 'Worklist nhiệm vụ xét nghiệm của 1 phòng Lab',
        description: 'Trả về danh sách LabTask theo phòng Lab, có thể lọc thêm theo trạng thái và kỹ thuật viên phụ trách.',
    })
    @ApiOkResponse({ description: 'Danh sách nhiệm vụ xét nghiệm.' })
    async list(@Query() query: ListLabTasksQueryDto) {
        return this.labTaskService.listWorklist(query);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Chi tiết 1 nhiệm vụ xét nghiệm' })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Chi tiết nhiệm vụ, kèm kết quả (nếu đã có).' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy nhiệm vụ xét nghiệm.' })
    async detail(@Param('id') id: string) {
        return this.labTaskService.getById(id);
    }

    /**
     * POST /lab-tasks/:id/verify-payment
     * Gọi bởi module Thanh toán (webhook/event) ngay khi hoá đơn được thanh toán thành công.
     * Đây là điều kiện tiên quyết để nhiệm vụ có thể được tiếp nhận thực hiện.
     */
    @Post(':id/verify-payment')
    @ApiOperation({
        summary: 'Xác nhận thanh toán cho 1 nhiệm vụ xét nghiệm',
        description:
            "Đánh dấu paymentVerified = true và chuyển trạng thái từ 'payment_pending' sang 'ready'. " +
            'Idempotent — an toàn khi gọi lại nhiều lần (VD: webhook thanh toán retry).',
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Nhiệm vụ sau khi xác nhận thanh toán.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy nhiệm vụ xét nghiệm.' })
    async verifyPayment(@Param('id') id: string) {
        return this.labTaskService.verifyPayment(id);
    }

    @Patch(':id/assign')
    @ApiOperation({
        summary: 'Gán kỹ thuật viên phụ trách nhiệm vụ',
        description: 'Kỹ thuật viên được gán phải thuộc phòng Lab của nhiệm vụ (LabStaffRoomAssignment).',
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Nhiệm vụ sau khi gán kỹ thuật viên.' })
    @ApiBadRequestResponse({ description: 'Kỹ thuật viên không thuộc phòng Lab của nhiệm vụ.' })
    async assign(@Param('id') id: string, @Body() dto: AssignLabTaskDto) {
        return this.labTaskService.assign(id, dto);
    }

    /**
     * POST /lab-tasks/:id/receive
     * Kỹ thuật viên tiếp nhận chỉ định để bắt đầu thực hiện xét nghiệm.
     * Bị từ chối (403) nếu bệnh nhân chưa hoàn tất thanh toán — đây là điểm thực thi
     * chính của ràng buộc "chỉ tiến hành khi đã thanh toán".
     */
    @Post(':id/receive')
    @ApiOperation({
        summary: 'Tiếp nhận nhiệm vụ xét nghiệm để bắt đầu thực hiện',
        description:
            "Chuyển trạng thái 'ready' -> 'in_progress'. Bị từ chối nếu bệnh nhân chưa thanh toán " +
            "(paymentVerified = false / status = 'payment_pending').",
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Nhiệm vụ sau khi tiếp nhận (status = in_progress).' })
    @ApiForbiddenResponse({ description: 'Bệnh nhân chưa hoàn tất thanh toán cho chỉ định này.' })
    @ApiBadRequestResponse({ description: "Nhiệm vụ không ở trạng thái 'ready'." })
    async receive(@Param('id') id: string, @Body() dto: ReceiveLabTaskDto) {
        return this.labTaskService.receive(id, dto);
    }

    @Post(':id/cancel')
    @ApiOperation({ summary: 'Huỷ nhiệm vụ xét nghiệm' })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Nhiệm vụ sau khi huỷ (status = cancelled).' })
    @ApiBadRequestResponse({ description: 'Nhiệm vụ đã hoàn tất hoặc đã huỷ trước đó.' })
    async cancel(@Param('id') id: string, @Body() dto: CancelLabTaskDto) {
        return this.labTaskService.cancel(id, dto);
    }
}
