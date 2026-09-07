import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiCreatedResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { LabResultService } from './lab-result.service';
import { SubmitLabResultDto } from './dtos/submit-lab-result.dto';
import { UpdateLabResultDto } from './dtos/update-lab-result.dto';
import { AddLabAttachmentDto } from './dtos/add-lab-attachment.dto';

/**
 * Nhập & tra cứu kết quả xét nghiệm — do Kỹ thuật viên phòng Lab thực hiện (riêng `update` cũng
 * cho phép bác sĩ, xem ghi chú ở method đó).
 * Kết quả lưu ở đây tự động trở thành một phần của EMR thông qua quan hệ
 * LabResult -> LabTask -> TestOrderItem -> Encounter (không cần đồng bộ thủ công sang bảng khác).
 *
 * AUTH: mọi route đều gắn JwtAuthGuard. Actor ghi vào bản ghi (enteredByUserId/reviewedByUserId/
 * uploadedByUserId) LUÔN lấy từ `@CurrentUser()` (JWT) — không còn nhận qua body. Vai trò được
 * assert trong LabResultService qua ActorRoleService (cùng cơ chế với module lab-task-intake).
 */
@ApiTags('Lab Results')
@ApiBearerAuth()
@Controller()
export class LabResultController {
    constructor(private readonly labResultService: LabResultService) {}

    /**
     * POST /lab-tasks/:id/results
     * Nhập kết quả xét nghiệm (chỉ số kỹ thuật) cho 1 nhiệm vụ đang 'in_progress'.
     * Bị từ chối nếu nhiệm vụ chưa qua ràng buộc thanh toán hoặc chưa được tiếp nhận.
     * Sau khi lưu, hệ thống tự động chạy phát hiện bất thường + khung AI + kiểm tra hoàn tất.
     * Người nhập (từ JWT) phải có actorRole LAB_STAFF.
     */
    @Post('lab-tasks/:id/results')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
        summary: 'Nhập kết quả xét nghiệm cho 1 nhiệm vụ',
        description:
            "Yêu cầu nhiệm vụ đang ở trạng thái 'in_progress' (đã qua ràng buộc thanh toán). " +
            "Sau khi lưu, LabTask chuyển 'completed' và hệ thống tự chạy detection/AI/thông báo hoàn tất ở nền. " +
            'Người gọi (từ JWT) phải có actorRole LAB_STAFF.',
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
    @ApiCreatedResponse({ description: 'Kết quả xét nghiệm đã lưu.' })
    @ApiBadRequestResponse({ description: "Nhiệm vụ chưa ở trạng thái 'in_progress' hoặc đã có kết quả." })
    @ApiForbiddenResponse({ description: 'Người gọi API không có actorRole LAB_STAFF.' })
    async submit(
        @Param('id') labTaskId: string,
        @Body() dto: SubmitLabResultDto,
        @CurrentUser('userId') enteredByUserId: string,
    ) {
        return this.labResultService.submitResult(labTaskId, dto, enteredByUserId);
    }

    @Get('lab-tasks/:id/result')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Kết quả xét nghiệm của 1 nhiệm vụ' })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Kết quả xét nghiệm.' })
    @ApiNotFoundResponse({ description: 'Nhiệm vụ chưa có kết quả.' })
    async byLabTask(@Param('id') labTaskId: string) {
        return this.labResultService.getByLabTaskId(labTaskId);
    }

    @Get('lab-results/:id')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
        summary: 'Chi tiết 1 kết quả xét nghiệm',
        description: 'Kèm giá trị từng tham số, cảnh báo bất thường, tệp đính kèm, và kết quả phân tích AI (nếu có).',
    })
    @ApiParam({ name: 'id', description: 'ID kết quả xét nghiệm (labResultId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Chi tiết kết quả xét nghiệm.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy kết quả xét nghiệm.' })
    async detail(@Param('id') labResultId: string) {
        return this.labResultService.getById(labResultId);
    }

    /**
     * PATCH /lab-results/:id
     * Sửa/bổ sung kết quả. Nếu kết quả đã 'final' và có sửa giá trị, tự chuyển sang 'corrected'
     * để lưu vết đính chính. Re-run detection/AI/completion-check ở nền sau khi cập nhật.
     * Người sửa (từ JWT) phải có actorRole LAB_STAFF hoặc DOCTOR — bác sĩ có thể tự tay đính chính/
     * xác nhận kết quả, không chỉ riêng kỹ thuật viên đã nhập ban đầu.
     */
    @Patch('lab-results/:id')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
        summary: 'Sửa / bổ sung kết quả xét nghiệm',
        description:
            "Chỉ field được gửi lên mới thay đổi. Tự chuyển resultStatus 'final' -> 'corrected' khi sửa giá trị " +
            'đã chốt. Người gọi (từ JWT) phải có actorRole LAB_STAFF hoặc DOCTOR.',
    })
    @ApiParam({ name: 'id', description: 'ID kết quả xét nghiệm (labResultId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Kết quả xét nghiệm sau khi cập nhật.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy kết quả xét nghiệm.' })
    @ApiForbiddenResponse({ description: 'Người gọi API không có actorRole LAB_STAFF hoặc DOCTOR.' })
    async update(
        @Param('id') labResultId: string,
        @Body() dto: UpdateLabResultDto,
        @CurrentUser('userId') reviewedByUserId: string,
    ) {
        return this.labResultService.updateResult(labResultId, dto, reviewedByUserId);
    }

    /**
     * POST /lab-results/:id/attachments
     * Tải lên tệp/hình ảnh đính kèm (VD: phim X-quang, PDF kết quả máy). Việc upload vật lý
     * lên storage được xử lý trước khi gọi API này — DTO chỉ nhận URL cuối cùng.
     * Người tải lên (từ JWT) phải có actorRole LAB_STAFF.
     */
    @Post('lab-results/:id/attachments')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Thêm tệp/hình ảnh đính kèm kết quả' })
    @ApiParam({ name: 'id', description: 'ID kết quả xét nghiệm (labResultId)', format: 'uuid' })
    @ApiCreatedResponse({ description: 'Tệp đính kèm đã lưu.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy kết quả xét nghiệm.' })
    @ApiForbiddenResponse({ description: 'Người gọi API không có actorRole LAB_STAFF.' })
    async addAttachment(
        @Param('id') labResultId: string,
        @Body() dto: AddLabAttachmentDto,
        @CurrentUser('userId') uploadedByUserId: string,
    ) {
        return this.labResultService.addAttachment(labResultId, dto, uploadedByUserId);
    }

    @Get('lab-results/:id/attachments')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Danh sách tệp/hình ảnh đính kèm của 1 kết quả xét nghiệm' })
    @ApiParam({ name: 'id', description: 'ID kết quả xét nghiệm (labResultId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách tệp đính kèm.' })
    async listAttachments(@Param('id') labResultId: string) {
        return this.labResultService.listAttachments(labResultId);
    }
}
