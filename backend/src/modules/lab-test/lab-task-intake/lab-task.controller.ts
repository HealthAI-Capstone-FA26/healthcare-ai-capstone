import { Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Body } from '@nestjs/common';
import {
    ApiBearerAuth,
    ApiConflictResponse,
    ApiForbiddenResponse,
    ApiBadRequestResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { LabTaskService } from './lab-task.service';
import { ListLabTasksQueryDto } from './dtos/list-lab-tasks-query.dto';
import { AssignLabTaskDto } from './dtos/assign-lab-task.dto';
import { ReceiveLabTaskDto } from './dtos/receive-lab-task.dto';
import { ReportLabTaskExceptionDto } from './dtos/report-lab-task-exception.dto';
import { ResolveLabTaskExceptionDto } from './dtos/resolve-lab-task-exception.dto';

/**
 * SE04 — Tiếp nhận & vòng đời nhiệm vụ cận lâm sàng (DiagnosticTask) tại các phòng: xét nghiệm máu, ECG, siêu âm tim,
 * X-quang. Do kỹ thuật viên thao tác (riêng `resolve-exception` là quyết định lâm sàng của bác sĩ).
 *
 * Actor luôn lấy từ JWT (`@CurrentUser()`); vai trò được assert trong LabTaskService qua ActorRoleService.
 * Toàn bộ route yêu cầu đăng nhập (guard cấp class).
 *
 * KHÔNG có endpoint xác nhận thanh toán qua HTTP: module Thanh toán gọi thẳng LabTaskService.verifyPayment
 * (service-to-service). Endpoint cũ không có guard cho phép bất kỳ ai đánh dấu "đã thanh toán" nên đã bị gỡ.
 *
 * KHÔNG có endpoint huỷ cho phòng thực hiện — chỉ `report-exception`. Huỷ xảy ra qua event 'order-item.cancelled'
 * (SE02) hoặc bác sĩ chọn 'cancel' ở `resolve-exception`.
 */
@ApiTags('Lab Tasks (Diagnostic Tasks)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('lab-tasks')
export class LabTaskController {
    constructor(private readonly labTaskService: LabTaskService) { }

    /** GET /lab-tasks — worklist theo phòng/loại/trạng thái; sắp theo ưu tiên (stat > urgent > routine) rồi readyAt. */
    @Get()
    @ApiOperation({
        summary: 'Worklist nhiệm vụ cận lâm sàng của 1 phòng',
        description:
            'Danh sách DiagnosticTask lọc theo phòng/loại/trạng thái/ưu tiên/KTV. Sắp xếp stat > urgent > routine, rồi theo thời điểm vào hàng đợi.',
    })
    @ApiOkResponse({ description: 'Danh sách nhiệm vụ cận lâm sàng.' })
    async list(@Query() query: ListLabTasksQueryDto) {
        return this.labTaskService.listWorklist(query);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Chi tiết 1 nhiệm vụ cận lâm sàng' })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ cận lâm sàng (taskId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Chi tiết nhiệm vụ, kèm kết quả (nếu đã có).' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy nhiệm vụ cận lâm sàng.' })
    async detail(@Param('id') id: string) {
        return this.labTaskService.getById(id);
    }

    @Patch(':id/assign')
    @ApiOperation({
        summary: 'Gán trước hoặc chuyển (reassign) kỹ thuật viên phụ trách nhiệm vụ',
        description:
            'Dùng để pre-assign một KTV cụ thể trước khi task được tự nhận, hoặc để chuyển task đang ' +
            "'in_progress' sang KTV khác. Người gọi API (lấy từ JWT) phải có actorRole LAB_STAFF. " +
            'KTV được gán (trong body) phải thuộc phòng thực hiện của nhiệm vụ (DiagnosticStaffRoomAssignment). ' +
            'Không áp dụng cho task đã completed/cancelled.',
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ cận lâm sàng (taskId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Nhiệm vụ sau khi gán kỹ thuật viên.' })
    @ApiBadRequestResponse({
        description: "Kỹ thuật viên không thuộc phòng thực hiện của nhiệm vụ, hoặc nhiệm vụ đã completed/cancelled.",
    })
    @ApiForbiddenResponse({ description: 'Người gọi API không có actorRole LAB_STAFF.' })
    async assign(
        @Param('id') id: string,
        @Body() dto: AssignLabTaskDto,
        @CurrentUser('userId') actingUserId: string,
    ) {
        return this.labTaskService.assign(id, dto, actingUserId);
    }

    /**
     * POST /lab-tasks/:id/receive
     * Kỹ thuật viên tiếp nhận chỉ định để bắt đầu thực hiện xét nghiệm — chính KTV đang gọi API
     * (từ JWT) là người tiếp nhận, không còn field `receivingLabStaffId` trong body nữa.
     * Bị từ chối (403) nếu bệnh nhân chưa hoàn tất thanh toán — đây là điểm thực thi
     * chính của ràng buộc "chỉ tiến hành khi đã thanh toán".
     */
    @Post(':id/receive')
    @ApiOperation({
        summary: 'Tiếp nhận nhiệm vụ cận lâm sàng để bắt đầu thực hiện',
        description:
            "Chuyển trạng thái 'ready' -> 'in_progress'. Người tiếp nhận là chính người gọi API " +
            "(lấy từ JWT), phải có actorRole LAB_STAFF và thuộc phòng thực hiện của nhiệm vụ. Với xét nghiệm máu có thể gửi specimenCode/specimenCollectedAt. Cùng lúc cập nhật DiagnosticOrder và Encounter ('diagnostics_in_progress'). Bị từ chối " +
            "nếu bệnh nhân chưa thanh toán (paymentVerified = false / status = 'payment_pending'). " +
            'Việc chiếm task được thực hiện atomic ở tầng DB (compare-and-swap) — nếu 2 KTV cùng bấm ' +
            'nhận 1 task trống cùng lúc, chỉ 1 request thành công, request còn lại nhận 409 Conflict.',
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ cận lâm sàng (taskId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Nhiệm vụ sau khi tiếp nhận (status = in_progress).' })
    @ApiForbiddenResponse({
        description:
            'Bệnh nhân chưa hoàn tất thanh toán, người gọi không có actorRole LAB_STAFF, hoặc nhiệm vụ ' +
            'đã được phân công cho kỹ thuật viên khác.',
    })
    @ApiBadRequestResponse({ description: "Nhiệm vụ không ở trạng thái 'ready'." })
    @ApiConflictResponse({
        description: 'Nhiệm vụ vừa được kỹ thuật viên khác tiếp nhận trước đó (race condition).',
    })
    async receive(
        @Param('id') id: string,
        @Body() dto: ReceiveLabTaskDto,
        @CurrentUser('userId') receivingUserId: string,
    ) {
        return this.labTaskService.receive(id, receivingUserId, dto);
    }

    /**
     * POST /lab-tasks/:id/report-exception
     * Phòng Lab báo cáo KHÔNG THỂ tiếp tục thực hiện (mẫu bị từ chối, bệnh nhân không có mặt...).
     * Người báo cáo là chính người gọi API (từ JWT) — không còn field `reportedByUserId` trong body.
     * Đây KHÔNG phải huỷ — task chỉ chuyển sang 'on_hold' và phát event để bác sĩ/module Order
     * quyết định bước tiếp theo (huỷ hẳn chỉ định, hoặc yêu cầu lấy lại mẫu).
     */
    @Post(':id/report-exception')
    @ApiOperation({
        summary: 'Báo cáo ngoại lệ khiến phòng thực hiện không thể tiếp tục thực hiện',
        description:
            "Chuyển trạng thái sang 'on_hold' (trung gian, KHÔNG kết thúc) và phát event cho bác sĩ/" +
            'module Order biết để quyết định bước tiếp theo. Người gọi (từ JWT) phải có actorRole ' +
            'LAB_STAFF. Phòng Lab không có quyền tự huỷ chỉ định.',
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ cận lâm sàng (taskId)', format: 'uuid' })
    @ApiOkResponse({ description: "Nhiệm vụ sau khi báo cáo (status = on_hold)." })
    @ApiBadRequestResponse({
        description: "Nhiệm vụ đã completed/cancelled/on_hold, không thể báo cáo ngoại lệ thêm.",
    })
    @ApiForbiddenResponse({ description: 'Người gọi API không có actorRole LAB_STAFF.' })
    async reportException(
        @Param('id') id: string,
        @Body() dto: ReportLabTaskExceptionDto,
        @CurrentUser('userId') reportedByUserId: string,
    ) {
        return this.labTaskService.reportException(id, dto, reportedByUserId);
    }

    /**
     * POST /lab-tasks/:id/resolve-exception
     * Bác sĩ (qua module Order) quyết định bước tiếp theo cho một nhiệm vụ đang 'on_hold':
     * 'retry' (lấy lại mẫu, quay về 'ready') hoặc 'cancel' (huỷ hẳn chỉ định).
     * Người quyết định là chính người gọi API (từ JWT) — LabTaskService assert actorRole phải là
     * DOCTOR trước khi thực hiện, vì đây là quyết định lâm sàng, không phải hành động của phòng thực hiện.
     */
    @Post(':id/resolve-exception')
    @ApiOperation({
        summary: "Bác sĩ xử lý ngoại lệ đang 'on_hold' của 1 nhiệm vụ cận lâm sàng",
        description:
            "'retry': quay về 'ready' để lấy lại mẫu/thực hiện lại (giữ nguyên paymentVerified, " +
            "xoá KTV/mốc thời gian tiếp nhận cũ). 'cancel': chuyển 'cancelled', dùng chung logic " +
            "với đường cascade từ module Order để không có 2 nguồn sự thật cho việc huỷ. Người gọi " +
            '(từ JWT) phải có actorRole DOCTOR.',
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ cận lâm sàng (taskId)', format: 'uuid' })
    @ApiOkResponse({ description: "Nhiệm vụ sau khi xử lý (status = 'ready' hoặc 'cancelled')." })
    @ApiBadRequestResponse({ description: "Nhiệm vụ không ở trạng thái 'on_hold'." })
    @ApiForbiddenResponse({ description: 'Người gọi API không có actorRole DOCTOR.' })
    @ApiConflictResponse({
        description: 'Nhiệm vụ vừa được xử lý bởi một quyết định khác (race condition).',
    })
    @ApiNotFoundResponse({ description: 'Không tìm thấy nhiệm vụ cận lâm sàng.' })
    async resolveException(
        @Param('id') id: string,
        @Body() dto: ResolveLabTaskExceptionDto,
        @CurrentUser('userId') resolvedByUserId: string,
    ) {
        return this.labTaskService.resolveException(id, dto, resolvedByUserId);
    }
}
