import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiCreatedResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { LabResultService } from './lab-result.service';
import { SubmitLabResultDto } from './dtos/submit-lab-result.dto';
import { UpdateLabResultDto } from './dtos/update-lab-result.dto';
import { AddLabAttachmentDto } from './dtos/add-lab-attachment.dto';

/**
 * Nhập & tra cứu kết quả xét nghiệm — do Kỹ thuật viên phòng Lab thực hiện.
 * Kết quả lưu ở đây tự động trở thành một phần của EMR thông qua quan hệ
 * LabResult -> LabTask -> TestOrderItem -> Encounter (không cần đồng bộ thủ công sang bảng khác).
 * TODO: gắn Guard role LAB_STAFF khi có auth module.
 */
@ApiTags('Lab Results')
@Controller()
export class LabResultController {
    constructor(private readonly labResultService: LabResultService) {}

    /**
     * POST /lab-tasks/:id/results
     * Nhập kết quả xét nghiệm (chỉ số kỹ thuật) cho 1 nhiệm vụ đang 'in_progress'.
     * Bị từ chối nếu nhiệm vụ chưa qua ràng buộc thanh toán hoặc chưa được tiếp nhận.
     * Sau khi lưu, hệ thống tự động chạy phát hiện bất thường + khung AI + kiểm tra hoàn tất.
     */
    @Post('lab-tasks/:id/results')
    @ApiOperation({
        summary: 'Nhập kết quả xét nghiệm cho 1 nhiệm vụ',
        description:
            "Yêu cầu nhiệm vụ đang ở trạng thái 'in_progress' (đã qua ràng buộc thanh toán). " +
            "Sau khi lưu, LabTask chuyển 'completed' và hệ thống tự chạy detection/AI/thông báo hoàn tất ở nền.",
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
    @ApiCreatedResponse({ description: 'Kết quả xét nghiệm đã lưu.' })
    @ApiBadRequestResponse({ description: "Nhiệm vụ chưa ở trạng thái 'in_progress' hoặc đã có kết quả." })
    async submit(@Param('id') labTaskId: string, @Body() dto: SubmitLabResultDto) {
        return this.labResultService.submitResult(labTaskId, dto);
    }

    @Get('lab-tasks/:id/result')
    @ApiOperation({ summary: 'Kết quả xét nghiệm của 1 nhiệm vụ' })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Kết quả xét nghiệm.' })
    @ApiNotFoundResponse({ description: 'Nhiệm vụ chưa có kết quả.' })
    async byLabTask(@Param('id') labTaskId: string) {
        return this.labResultService.getByLabTaskId(labTaskId);
    }

    @Get('lab-results/:id')
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
     */
    @Patch('lab-results/:id')
    @ApiOperation({
        summary: 'Sửa / bổ sung kết quả xét nghiệm',
        description: "Chỉ field được gửi lên mới thay đổi. Tự chuyển resultStatus 'final' -> 'corrected' khi sửa giá trị đã chốt.",
    })
    @ApiParam({ name: 'id', description: 'ID kết quả xét nghiệm (labResultId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Kết quả xét nghiệm sau khi cập nhật.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy kết quả xét nghiệm.' })
    async update(@Param('id') labResultId: string, @Body() dto: UpdateLabResultDto) {
        return this.labResultService.updateResult(labResultId, dto);
    }

    /**
     * POST /lab-results/:id/attachments
     * Tải lên tệp/hình ảnh đính kèm (VD: phim X-quang, PDF kết quả máy). Việc upload vật lý
     * lên storage được xử lý trước khi gọi API này — DTO chỉ nhận URL cuối cùng.
     */
    @Post('lab-results/:id/attachments')
    @ApiOperation({ summary: 'Thêm tệp/hình ảnh đính kèm kết quả' })
    @ApiParam({ name: 'id', description: 'ID kết quả xét nghiệm (labResultId)', format: 'uuid' })
    @ApiCreatedResponse({ description: 'Tệp đính kèm đã lưu.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy kết quả xét nghiệm.' })
    async addAttachment(@Param('id') labResultId: string, @Body() dto: AddLabAttachmentDto) {
        return this.labResultService.addAttachment(labResultId, dto);
    }

    @Get('lab-results/:id/attachments')
    @ApiOperation({ summary: 'Danh sách tệp/hình ảnh đính kèm của 1 kết quả xét nghiệm' })
    @ApiParam({ name: 'id', description: 'ID kết quả xét nghiệm (labResultId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách tệp đính kèm.' })
    async listAttachments(@Param('id') labResultId: string) {
        return this.labResultService.listAttachments(labResultId);
    }
}
