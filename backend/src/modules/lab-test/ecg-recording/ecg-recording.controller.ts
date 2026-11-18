import { Body, Controller, Get, Param, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
    ApiBadRequestResponse,
    ApiBearerAuth,
    ApiBody,
    ApiConflictResponse,
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
import { EcgRecordingService } from './ecg-recording.service';
import { CreateEcgRecordingDto, ECG_RECORDING_TYPES, ECG_SIGNAL_FORMATS } from './dto/create-ecg-recording.dto';
import { ecgUploadConfig } from './ecg-upload.config';

/** SE04 — Bản ghi ECG. Toàn bộ route yêu cầu đăng nhập; ghi/huỷ chỉ LAB_STAFF phụ trách nhiệm vụ. */
@ApiTags('ECG Recordings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class EcgRecordingController {
    constructor(private readonly ecgRecordingService: EcgRecordingService) {}

    @Post('lab-tasks/:taskId/ecg-recordings')
    @UseInterceptors(FileInterceptor('file', ecgUploadConfig))
    @ApiConsumes('multipart/form-data')
    @ApiOperation({
        summary: 'Tải bản ghi ECG (file upload) cho 1 nhiệm vụ ECG',
        description:
            "Nhiệm vụ phải là ECG, 'in_progress' và do bạn phụ trách. Tệp tối đa 50MB, phần mở rộng phải khớp signalFormat " +
            '(WFDB nén .zip gồm .hea + .dat). Lưu xong, AI phân tích chạy NỀN (không chờ) trừ khi autoAnalyze=false; ' +
            'AI lỗi/chưa cấu hình không ảnh hưởng quy trình thủ công.',
    })
    @ApiParam({ name: 'taskId', format: 'uuid' })
    @ApiBody({
        schema: {
            type: 'object',
            required: ['file', 'recordingType', 'signalFormat', 'sampleRateHz', 'numLeads'],
            properties: {
                file: { type: 'string', format: 'binary' },
                recordingType: { type: 'string', enum: [...ECG_RECORDING_TYPES] },
                signalFormat: { type: 'string', enum: [...ECG_SIGNAL_FORMATS] },
                sampleRateHz: { type: 'integer', example: 500 },
                numLeads: { type: 'integer', example: 12 },
                leadNames: { type: 'string', example: 'I,II,III,aVR,aVL,aVF,V1,V2,V3,V4,V5,V6' },
                durationMs: { type: 'integer' },
                startedAt: { type: 'string', format: 'date-time' },
                endedAt: { type: 'string', format: 'date-time' },
                deviceModel: { type: 'string' },
                deviceSerial: { type: 'string' },
                acquisitionMeta: { type: 'string', description: 'Chuỗi JSON' },
                autoAnalyze: { type: 'boolean', default: true },
            },
        },
    })
    @ApiCreatedResponse({ description: 'Bản ghi ECG đã lưu (status completed).' })
    @ApiBadRequestResponse({ description: 'Sai định dạng/metadata, không phải nhiệm vụ ECG, hoặc task chưa in_progress.' })
    @ApiForbiddenResponse({ description: 'Chưa thanh toán, không phải LAB_STAFF, hoặc task do KTV khác phụ trách.' })
    @ApiConflictResponse({ description: 'Tệp trùng (cùng checksum) đã tải cho nhiệm vụ này.' })
    async upload(
        @Param('taskId') taskId: string,
        @Body() dto: CreateEcgRecordingDto,
        @UploadedFile() file: Express.Multer.File | undefined,
        @CurrentUser('userId') userId: string,
    ) {
        return this.ecgRecordingService.createFromFile(taskId, dto, file, userId);
    }

    @Get('lab-tasks/:taskId/ecg-recordings')
    @ApiOperation({ summary: 'Danh sách bản ghi ECG của 1 nhiệm vụ (kèm tóm tắt phân tích hiện hành)' })
    @ApiParam({ name: 'taskId', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách bản ghi, mới nhất trước.' })
    async listByTask(@Param('taskId') taskId: string) {
        return this.ecgRecordingService.listByTask(taskId);
    }

    @Get('ecg-recordings/:id')
    @ApiOperation({ summary: 'Chi tiết bản ghi ECG', description: 'Kèm mọi lần phân tích AI (mới nhất trước) và các sự kiện bất thường.' })
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy bản ghi.' })
    async detail(@Param('id') id: string) {
        return this.ecgRecordingService.getById(id);
    }

    @Get('ecg-recordings/:id/signal-url')
    @ApiOperation({ summary: 'URL tạm (10 phút) để tải/hiển thị tín hiệu gốc' })
    @ApiParam({ name: 'id', format: 'uuid' })
    async signalUrl(@Param('id') id: string) {
        return this.ecgRecordingService.getSignalUrl(id);
    }

    @Patch('ecg-recordings/:id/cancel')
    @ApiOperation({ summary: 'Huỷ bản ghi tải nhầm (chỉ khi nhiệm vụ còn in_progress)' })
    @ApiParam({ name: 'id', format: 'uuid' })
    @ApiForbiddenResponse({ description: 'Không phải LAB_STAFF phụ trách nhiệm vụ.' })
    async cancel(@Param('id') id: string, @CurrentUser('userId') userId: string) {
        return this.ecgRecordingService.cancel(id, userId);
    }
}
