import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
    ApiAcceptedResponse,
    ApiBearerAuth,
    ApiConflictResponse,
    ApiForbiddenResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { EcgAnalysisService } from './ecg-analysis.service';
import { EcgAnomalyEventService } from './ecg-anomaly-event.service';
import { ReanalyzeEcgDto } from './dto/reanalyze-ecg.dto';
import { ReviewEcgEventDto } from './dto/review-ecg-event.dto';
import { ListEcgEventsQueryDto } from './dto/list-ecg-events-query.dto';

/**
 * SE04 — Phân tích AI ECG & cảnh báo bất thường. Toàn bộ route yêu cầu đăng nhập; vai trò assert trong service.
 * Realtime: WebSocket namespace `/lab-alerts`, room `encounter:{id}`, sự kiện `ecg-alert-update`.
 */
@ApiTags('ECG AI Analysis')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class EcgAnalysisController {
    constructor(
        private readonly analysisService: EcgAnalysisService,
        private readonly eventService: EcgAnomalyEventService,
    ) {}

    @Get('ecg-recordings/:id/analyses')
    @ApiOperation({ summary: 'Mọi lần phân tích AI của 1 bản ghi ECG (mới nhất trước), kèm sự kiện bất thường' })
    @ApiParam({ name: 'id', description: 'ecgRecordingId', format: 'uuid' })
    async list(@Param('id') id: string) {
        return this.analysisService.listByRecording(id);
    }

    @Post('ecg-recordings/:id/analyses')
    @HttpCode(202)
    @ApiOperation({
        summary: 'Chạy lại phân tích AI (reanalysis)',
        description:
            "LAB_STAFF hoặc DOCTOR. Trả 202 + analysis 'queued'; kết quả đến qua realtime hoặc GET. Có thể chọn modelVersionId " +
            "('active' | 'candidate') và threshold — dùng để so sánh model trên cùng bản ghi.",
    })
    @ApiParam({ name: 'id', description: 'ecgRecordingId', format: 'uuid' })
    @ApiAcceptedResponse({ description: "Phân tích đã xếp hàng (status 'queued')." })
    @ApiConflictResponse({ description: 'Bản ghi đang có phân tích chưa xong.' })
    async reanalyze(@Param('id') id: string, @Body() dto: ReanalyzeEcgDto, @CurrentUser('userId') userId: string) {
        return this.analysisService.reanalyze(id, dto, userId);
    }

    @Get('ecg-analyses/:analysisId')
    @ApiOperation({ summary: 'Chi tiết 1 lần phân tích AI' })
    @ApiParam({ name: 'analysisId', format: 'uuid' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy phân tích.' })
    async detail(@Param('analysisId') analysisId: string) {
        return this.analysisService.getById(analysisId);
    }

    @Get('encounters/:encounterId/ecg-anomaly-events')
    @ApiOperation({ summary: 'Feed cảnh báo bất thường ECG của 1 lượt khám (analysis hiện hành)' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách sự kiện, mới nhất trước.' })
    async feed(@Param('encounterId') encounterId: string, @Query() query: ListEcgEventsQueryDto) {
        return this.eventService.listByEncounter(encounterId, query);
    }

    @Patch('ecg-anomaly-events/:eventId/acknowledge')
    @ApiOperation({ summary: "Xác nhận đã nhận cảnh báo (alertStatus: active -> acknowledged)" })
    @ApiParam({ name: 'eventId', format: 'uuid' })
    @ApiForbiddenResponse({ description: 'Không phải DOCTOR/LAB_STAFF.' })
    @ApiConflictResponse({ description: "Cảnh báo không ở trạng thái 'active'." })
    async acknowledge(@Param('eventId') eventId: string, @CurrentUser('userId') userId: string) {
        return this.eventService.acknowledge(eventId, userId);
    }

    @Patch('ecg-anomaly-events/:eventId/resolve')
    @ApiOperation({ summary: "Đóng cảnh báo (alertStatus: active|acknowledged -> resolved)" })
    @ApiParam({ name: 'eventId', format: 'uuid' })
    @ApiConflictResponse({ description: 'Cảnh báo đã đóng.' })
    async resolve(@Param('eventId') eventId: string, @CurrentUser('userId') userId: string) {
        return this.eventService.resolve(eventId, userId);
    }

    @Patch('ecg-anomaly-events/:eventId/review')
    @ApiOperation({
        summary: 'Bác sĩ xác nhận AI đúng/sai (reviewVerdict)',
        description: 'Chỉ DOCTOR. Độc lập với alertStatus. Cho phép đổi ý (ghi đè).',
    })
    @ApiParam({ name: 'eventId', format: 'uuid' })
    @ApiForbiddenResponse({ description: 'Không phải DOCTOR.' })
    async review(@Param('eventId') eventId: string, @Body() dto: ReviewEcgEventDto, @CurrentUser('userId') userId: string) {
        return this.eventService.review(eventId, dto, userId);
    }
}
