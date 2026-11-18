import { Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiConflictResponse,
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
import { ALERT_STATUSES, LabResultAlertService } from './lab-result-alert.service';

/** Cảnh báo chỉ số cận lâm sàng nguy hiểm. Toàn bộ route yêu cầu đăng nhập (trước đây không có guard). */
@ApiTags('Lab Result Alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class LabResultAlertController {
    constructor(private readonly alertService: LabResultAlertService) {}

    @Post('lab-results/:id/detect-alerts')
    @ApiOperation({
        summary: 'Chạy lại phát hiện bất thường cho 1 kết quả',
        description: 'Đồng bộ isAbnormal + ResultValueAlert. Người gọi phải là LAB_STAFF hoặc DOCTOR.',
    })
    @ApiParam({ name: 'id', description: 'ID kết quả (resultId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Kết quả đánh giá từng chỉ số.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy kết quả.' })
    async detect(@Param('id') resultId: string, @CurrentUser('userId') userId: string) {
        return this.alertService.detect(resultId, userId);
    }

    @Get('encounters/:encounterId/result-alerts')
    @ApiOperation({ summary: 'Danh sách cảnh báo chỉ số của 1 lượt khám' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiQuery({ name: 'status', required: false, enum: ALERT_STATUSES })
    @ApiOkResponse({ description: 'Danh sách cảnh báo, mới nhất trước.' })
    async listByEncounter(@Param('encounterId') encounterId: string, @Query('status') status?: string) {
        return this.alertService.listByEncounter(encounterId, status);
    }

    @Patch('result-alerts/:alertId/confirm')
    @ApiOperation({ summary: "Xác nhận đã nhìn thấy cảnh báo (active -> confirmed)" })
    @ApiParam({ name: 'alertId', format: 'uuid' })
    @ApiForbiddenResponse({ description: 'Người gọi không phải DOCTOR/LAB_STAFF.' })
    @ApiConflictResponse({ description: "Cảnh báo không ở trạng thái 'active'." })
    async confirm(@Param('alertId') alertId: string, @CurrentUser('userId') userId: string) {
        return this.alertService.confirm(alertId, userId);
    }

    @Patch('result-alerts/:alertId/resolve')
    @ApiOperation({ summary: "Đánh dấu đã xử lý cảnh báo (active|confirmed -> resolved)" })
    @ApiParam({ name: 'alertId', format: 'uuid' })
    @ApiForbiddenResponse({ description: 'Người gọi không phải DOCTOR/LAB_STAFF.' })
    @ApiConflictResponse({ description: 'Cảnh báo đã resolved.' })
    async resolve(@Param('alertId') alertId: string, @CurrentUser('userId') userId: string) {
        return this.alertService.resolve(alertId, userId);
    }
}
