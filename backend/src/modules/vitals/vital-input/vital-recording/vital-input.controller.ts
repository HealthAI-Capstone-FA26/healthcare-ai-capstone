import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
    ApiCreatedResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiQuery,
    ApiTags,
} from '@nestjs/swagger';
import { VitalInputService } from './vital-input.service';
import { VitalSessionQueryService } from '../vital-session-history/vital-session-query.service';
import { RecordVitalSignsDto } from '../dtos/record-vital-signs.dto';
import { UpdateVitalSignsDto } from '../dtos/update-vital-signs.dto';
import { ListVitalSessionsQueryDto } from '../dtos/list-vital-sessions-query.dto';
import { LatestVitalSessionQueryDto } from '../dtos/latest-vital-session-query.dto';

/**
 * Ghi nhận và tra cứu chỉ số sinh hiệu / thể trạng của bệnh nhân — do Điều dưỡng thực hiện.
 * TODO: gắn Guard/Decorator kiểm tra role NURSE khi hệ thống đã có auth module.
 *
 * Lưu ý thứ tự route: 'latest' phải khai báo TRƯỚC ':id' để không bị ':id' nuốt mất
 * segment 'latest' (Nest/Express khớp route theo thứ tự khai báo).
 */
@ApiTags('Vital Sessions')
@Controller('vital-sessions')
export class VitalInputController {
    constructor(
        private readonly vitalInputService: VitalInputService,
        private readonly vitalSessionQueryService: VitalSessionQueryService,
    ) { }

    /**
     * POST /vital-sessions
     * Body: encounterId, patientId, recordedByUserId, measuredAt?, notes?,
     *       pulse?, systolicBp?, diastolicBp?, temperature?, respiratoryRate?, spo2?, height?, weight?
     *
     * BMI được hệ thống tự động tính khi có cả height và weight — điều dưỡng không cần tính tay.
     * Sau khi lưu thành công, hệ thống sẽ tự chạy phát hiện bất thường (rule/ai) ở background
     * và đẩy cảnh báo qua WebSocket (xem module vital-anomaly) nếu có chỉ số bất thường.
     */
    @Post()
    @ApiOperation({
        summary: 'Ghi nhận sinh hiệu / thể trạng',
        description:
            'Điều dưỡng ghi nhận mạch, huyết áp, nhiệt độ, nhịp thở, SpO2, chiều cao, cân nặng cho 1 lượt khám. ' +
            'BMI tự động tính nếu có đủ chiều cao + cân nặng. Sau khi lưu, hệ thống tự chạy phát hiện bất thường ở background.',
    })
    @ApiCreatedResponse({ description: 'Đã tạo phiên ghi nhận sinh hiệu, kèm các chỉ số đã lưu.' })
    async record(@Body() dto: RecordVitalSignsDto) {
        return this.vitalInputService.recordVitalSigns(dto);
    }

    /**
     * GET /vital-sessions?encounterId=...&limit=20
     * Lịch sử ghi nhận sinh hiệu của 1 lượt khám, mới nhất trước — dùng để vẽ bảng/biểu đồ
     * xu hướng trên giao diện điều dưỡng.
     */
    @Get()
    @ApiOperation({
        summary: 'Lịch sử ghi nhận sinh hiệu của 1 lượt khám',
        description: 'Trả về danh sách các lần đo của 1 encounter, mới nhất trước — dùng để vẽ bảng/biểu đồ xu hướng.',
    })
    @ApiQuery({ name: 'encounterId', required: true, description: 'ID lượt khám', format: 'uuid' })
    @ApiQuery({ name: 'limit', required: false, description: 'Số lần đo tối đa trả về (mặc định 20, tối đa 100)' })
    @ApiOkResponse({ description: 'Danh sách các phiên ghi nhận sinh hiệu, mới nhất trước.' })
    async list(@Query() query: ListVitalSessionsQueryDto) {
        return this.vitalSessionQueryService.listByEncounter(query.encounterId, query.limit);
    }

    /**
     * GET /vital-sessions/latest?encounterId=...
     * Lần đo gần nhất của lượt khám — để điều dưỡng đối chiếu nhanh với lần đang nhập.
     */
    @Get('latest')
    @ApiOperation({
        summary: 'Lần đo gần nhất của 1 lượt khám',
        description: 'Trả về phiên ghi nhận sinh hiệu gần nhất của encounter — để điều dưỡng đối chiếu nhanh với lần đang nhập.',
    })
    @ApiQuery({ name: 'encounterId', required: true, description: 'ID lượt khám', format: 'uuid' })
    @ApiOkResponse({ description: 'Phiên ghi nhận sinh hiệu gần nhất.' })
    @ApiNotFoundResponse({ description: 'Encounter chưa có lần ghi nhận sinh hiệu nào.' })
    async latest(@Query() query: LatestVitalSessionQueryDto) {
        return this.vitalSessionQueryService.getLatestByEncounter(query.encounterId);
    }

    /**
     * GET /vital-sessions/:id
     * Chi tiết 1 lần ghi nhận, kèm cảnh báo (nếu có) của từng chỉ số.
     */
    @Get(':id')
    @ApiOperation({
        summary: 'Chi tiết 1 phiên ghi nhận sinh hiệu',
        description: 'Trả về đầy đủ các chỉ số của 1 lần đo, kèm cảnh báo (nếu có) của từng chỉ số.',
    })
    @ApiParam({ name: 'id', description: 'ID phiên ghi nhận sinh hiệu (vitalSessionId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Chi tiết phiên ghi nhận sinh hiệu.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy phiên ghi nhận sinh hiệu.' })
    async detail(@Param('id') id: string) {
        return this.vitalSessionQueryService.getById(id);
    }

    /**
     * PATCH /vital-sessions/:id
     * Điều dưỡng sửa lại chỉ số đã nhập sai, hoặc bổ sung chỉ số còn thiếu, cho 1 lần đo đã lưu.
     * BMI được tính lại tự động nếu height/weight thay đổi. Cảnh báo liên quan sẽ được
     * làm mới ở background sau khi cập nhật (không cần gọi lại API detect-alerts thủ công).
     */
    @Patch(':id')
    @ApiOperation({
        summary: 'Sửa / bổ sung chỉ số cho 1 phiên đã ghi nhận',
        description:
            'Chỉ field được gửi lên mới thay đổi, field không gửi giữ nguyên. BMI tự tính lại nếu height/weight thay đổi. ' +
            'Cảnh báo liên quan được làm mới ở background sau khi cập nhật.',
    })
    @ApiParam({ name: 'id', description: 'ID phiên ghi nhận sinh hiệu (vitalSessionId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Phiên ghi nhận sinh hiệu sau khi cập nhật.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy phiên ghi nhận sinh hiệu.' })
    async update(@Param('id') id: string, @Body() dto: UpdateVitalSignsDto) {
        return this.vitalInputService.updateVitalSigns(id, dto);
    }
}
