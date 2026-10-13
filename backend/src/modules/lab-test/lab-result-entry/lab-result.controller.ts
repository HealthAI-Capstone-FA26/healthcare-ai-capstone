import { Body, Controller, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiBody,
    ApiConsumes,
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
import { ReviewLabResultDto } from './dtos/review-lab-result.dto';
import {
    AddLabAttachmentDto,
    LAB_ATTACHMENT_FILE_TYPES,
    LAB_ATTACHMENT_ROLES,
} from './dtos/add-lab-attachment.dto';
import { diagnosticUploadConfig } from './diagnostic-upload.config';

/**
 * SE04 — Nhập & tra cứu kết quả cận lâm sàng (DiagnosticResult). Kỹ thuật viên nhập; bác sĩ có thể sửa/duyệt.
 * Kết quả tự thuộc EMR qua quan hệ DiagnosticResult -> DiagnosticTask -> DiagnosticOrderItem -> Encounter.
 *
 * AUTH: guard cấp class. Actor (enteredBy/reviewedBy/uploadedBy) LUÔN lấy từ JWT, vai trò assert trong service.
 */
@ApiTags('Lab Results (Diagnostic Results)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class LabResultController {
    constructor(private readonly labResultService: LabResultService) {}

    @Post('lab-tasks/:id/results')
    @ApiOperation({
        summary: 'Nhập kết quả cận lâm sàng cho 1 nhiệm vụ',
        description:
            "Nhiệm vụ phải 'in_progress' (đã thanh toán + đã tiếp nhận). Dữ liệu bắt buộc theo resultKind của dịch vụ: " +
            'parametric -> values; image_report -> findings/overallConclusion; waveform (ECG) -> findings hoặc đã có ' +
            "bản ghi ECG hoàn tất. Lưu xong task 'completed', Order/Encounter được tính lại, detection chạy nền. " +
            'Người gọi phải là LAB_STAFF.',
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ (taskId)', format: 'uuid' })
    @ApiCreatedResponse({ description: 'Kết quả đã lưu.' })
    @ApiBadRequestResponse({ description: "Nhiệm vụ chưa 'in_progress', đã có kết quả, hoặc thiếu dữ liệu theo resultKind." })
    @ApiForbiddenResponse({ description: 'Chưa thanh toán hoặc người gọi không phải LAB_STAFF.' })
    async submit(
        @Param('id') taskId: string,
        @Body() dto: SubmitLabResultDto,
        @CurrentUser('userId') enteredByUserId: string,
    ) {
        return this.labResultService.submitResult(taskId, dto, enteredByUserId);
    }

    @Get('lab-tasks/:id/result')
    @ApiOperation({ summary: 'Kết quả của 1 nhiệm vụ' })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ (taskId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Kết quả cận lâm sàng.' })
    @ApiNotFoundResponse({ description: 'Nhiệm vụ chưa có kết quả.' })
    async byLabTask(@Param('id') taskId: string) {
        return this.labResultService.getByLabTaskId(taskId);
    }

    @Get('lab-results/:id')
    @ApiOperation({
        summary: 'Chi tiết 1 kết quả',
        description: 'Kèm giá trị từng tham số (+ cảnh báo), tệp đính kèm, người nhập/duyệt và dịch vụ/phòng của nhiệm vụ.',
    })
    @ApiParam({ name: 'id', description: 'ID kết quả (resultId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Chi tiết kết quả.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy kết quả.' })
    async detail(@Param('id') resultId: string) {
        return this.labResultService.getById(resultId);
    }

    @Patch('lab-results/:id')
    @ApiOperation({
        summary: 'Sửa / bổ sung kết quả',
        description:
            "Chỉ field được gửi mới đổi. Kết quả 'final' mà sửa chỉ số/mô tả/kết luận tự chuyển 'corrected'. " +
            'Người gọi phải là LAB_STAFF hoặc DOCTOR. Detection chạy lại ở nền.',
    })
    @ApiParam({ name: 'id', description: 'ID kết quả (resultId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Kết quả sau khi cập nhật.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy kết quả.' })
    @ApiForbiddenResponse({ description: 'Người gọi không phải LAB_STAFF hoặc DOCTOR.' })
    async update(
        @Param('id') resultId: string,
        @Body() dto: UpdateLabResultDto,
        @CurrentUser('userId') actingUserId: string,
    ) {
        return this.labResultService.updateResult(resultId, dto, actingUserId);
    }

    @Post('lab-results/:id/review')
    @ApiOperation({
        summary: 'Bác sĩ đọc/duyệt kết quả (ECG, siêu âm, X-quang...)',
        description: 'Ghi reviewedByUserId/reviewedAt; tuỳ chọn cập nhật kết luận và chốt final. Chỉ DOCTOR.',
    })
    @ApiParam({ name: 'id', description: 'ID kết quả (resultId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Kết quả sau khi duyệt.' })
    @ApiForbiddenResponse({ description: 'Người gọi không phải DOCTOR.' })
    async review(
        @Param('id') resultId: string,
        @Body() dto: ReviewLabResultDto,
        @CurrentUser('userId') reviewerUserId: string,
    ) {
        return this.labResultService.reviewResult(resultId, dto, reviewerUserId);
    }

    @Post('lab-results/:id/attachments')
    @UseInterceptors(FileInterceptor('file', diagnosticUploadConfig))
    @ApiConsumes('multipart/form-data')
    @ApiOperation({
        summary: 'Thêm tệp đính kèm kết quả',
        description: 'Ảnh X-quang, DICOM, ảnh/cine-loop siêu âm, PDF báo cáo, bản in ECG. Tối đa 50MB. Người gọi phải là LAB_STAFF.',
    })
    @ApiParam({ name: 'id', description: 'ID kết quả (resultId)', format: 'uuid' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['fileType'],
            properties: {
                file: { type: 'string', format: 'binary', description: 'Tệp tải lên trực tiếp' },
                fileType: { type: 'string', enum: [...LAB_ATTACHMENT_FILE_TYPES] },
                attachmentRole: { type: 'string', enum: [...LAB_ATTACHMENT_ROLES] },
                fileUrl: { type: 'string', description: 'Chỉ dùng khi KHÔNG gửi `file`' },
                mimeType: { type: 'string' },
                description: { type: 'string' },
                metadata: { type: 'string', description: 'Chuỗi JSON, vd {"view":"PA"}' },
                capturedAt: { type: 'string', format: 'date-time' },
            },
        },
    })
    @ApiCreatedResponse({ description: 'Tệp đính kèm đã lưu.' })
    @ApiBadRequestResponse({ description: 'Thiếu cả `file` lẫn `fileUrl`, hoặc metadata không phải JSON.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy kết quả.' })
    @ApiForbiddenResponse({ description: 'Người gọi không phải LAB_STAFF.' })
    async addAttachment(
        @Param('id') resultId: string,
        @Body() dto: AddLabAttachmentDto,
        @CurrentUser('userId') uploadedByUserId: string,
        @UploadedFile() file?: Express.Multer.File,
    ) {
        return this.labResultService.addAttachment(resultId, dto, uploadedByUserId, file);
    }

    @Get('lab-results/:id/attachments')
    @ApiOperation({ summary: 'Danh sách tệp đính kèm của 1 kết quả' })
    @ApiParam({ name: 'id', description: 'ID kết quả (resultId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách tệp đính kèm.' })
    async listAttachments(@Param('id') resultId: string) {
        return this.labResultService.listAttachments(resultId);
    }
}
