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
import { ReportLabTaskExceptionDto } from './dtos/report-lab-task-exception.dto';
import { ResolveLabTaskExceptionDto } from './dtos/resolve-lab-task-exception.dto';

/**
 * Tiếp nhận & vòng đời nhiệm vụ xét nghiệm (LabTask), do Kỹ thuật viên phòng Lab thao tác
 * (riêng `resolve-exception` là quyết định của bác sĩ — xem ghi chú ở method đó).
 *
 * Actor thực hiện (KTV nhận mẫu, người báo cáo ngoại lệ, bác sĩ resolve...) LUÔN lấy từ
 * `@CurrentUser()` (JWT, gắn bởi JwtAuthGuard) — KHÔNG còn nhận qua body nữa, tránh việc client
 * tự xưng "tôi là ai" trong request. Việc actor có đúng vai trò cần thiết (LAB_STAFF/DOCTOR)
 * được assert bên trong LabTaskService qua ActorRoleService, đọc thẳng UserProfile.actorRole —
 * cùng cơ chế đã dùng ở LabRoomService.assignStaff, tránh 2 nguồn kiểm tra vai trò khác nhau.
 *
 * LƯU Ý: controller này KHÔNG có endpoint huỷ chủ động cho phòng Lab. Phòng Lab không có thẩm
 * quyền huỷ chỉ định bác sĩ — nó chỉ có thể báo cáo ngoại lệ (`report-exception`). Việc huỷ
 * ('cancelled') chỉ xảy ra theo 1 trong 2 đường: cascade từ module Order thật qua
 * LabTaskOrderCancellationListener, hoặc bác sĩ chọn 'cancel' ở `resolve-exception` bên dưới khi
 * task đang 'on_hold' — cả 2 đều dùng chung `LabTaskService.applyCancellationFromOrder`.
 *
 * TODO: `resolve-exception` hiện nằm tạm ở module Lab vì module Order chưa tồn tại trong codebase
 * này. Khi triển khai module Order thật, cân nhắc chuyển quyết định "retry/cancel" của bác sĩ về
 * đó (Order gọi LabTaskService.resolveException hoặc phát OrderItemCancelledEvent tương ứng), và
 * endpoint dưới đây có thể trở thành nội bộ/được gọi lại từ Order thay vì lộ ra ngoài trực tiếp.
 */
@ApiTags('Lab Tasks')
@ApiBearerAuth()
@Controller('lab-tasks')
export class LabTaskController {
    constructor(private readonly labTaskService: LabTaskService) { }

    /**
     * GET /lab-tasks?labRoomId=...&status=...&assignedLabStaffId=...
     * Worklist của 1 phòng Lab — bắt buộc lọc theo labRoomId vì kỹ thuật viên chỉ được
     * xem/thao tác trong phạm vi phòng chuyên môn mình phụ trách.
     * Chỉ yêu cầu đã đăng nhập (bác sĩ cũng có thể cần xem worklist để theo dõi chỉ định của mình) —
     * không giới hạn thêm theo actorRole ở tầng route, vì query đã tự giới hạn theo labRoomId.
     */
    @Get()
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
        summary: 'Worklist nhiệm vụ xét nghiệm của 1 phòng Lab',
        description: 'Trả về danh sách LabTask theo phòng Lab, có thể lọc thêm theo trạng thái và kỹ thuật viên phụ trách.',
    })
    @ApiOkResponse({ description: 'Danh sách nhiệm vụ xét nghiệm.' })
    async list(@Query() query: ListLabTasksQueryDto) {
        return this.labTaskService.listWorklist(query);
    }

    @Get(':id')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({ summary: 'Chi tiết 1 nhiệm vụ xét nghiệm' })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Chi tiết nhiệm vụ, kèm kết quả (nếu đã có).' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy nhiệm vụ xét nghiệm.' })
    async detail(@Param('id') id: string) {
        return this.labTaskService.getById(id);
    }

    /**
     * POST /lab-tasks/:id/verify-payment
     * Gọi bởi module Thanh toán (webhook/event) ngay khi hoá đơn được thanh toán thành công —
     * đây là lời gọi service-to-service, KHÔNG phải hành động của một user đăng nhập, nên
     * KHÔNG gắn JwtAuthGuard ở đây (JWT của user không có ý nghĩa với 1 webhook).
     * TODO: khi có cơ chế xác thực service-to-service (VD: HMAC signature/API key riêng cho
     * module Thanh toán), gắn guard tương ứng ở đây — hiện endpoint này vẫn đang mở.
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
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
        summary: 'Gán trước hoặc chuyển (reassign) kỹ thuật viên phụ trách nhiệm vụ',
        description:
            'Dùng để pre-assign một KTV cụ thể trước khi task được tự nhận, hoặc để chuyển task đang ' +
            "'in_progress' sang KTV khác. Người gọi API (lấy từ JWT) phải có actorRole LAB_STAFF. " +
            'KTV được gán (trong body) phải thuộc phòng Lab của nhiệm vụ (LabStaffRoomAssignment). ' +
            'Không áp dụng cho task đã completed/cancelled.',
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
    @ApiOkResponse({ description: 'Nhiệm vụ sau khi gán kỹ thuật viên.' })
    @ApiBadRequestResponse({
        description: "Kỹ thuật viên không thuộc phòng Lab của nhiệm vụ, hoặc nhiệm vụ đã completed/cancelled.",
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
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
        summary: 'Tiếp nhận nhiệm vụ xét nghiệm để bắt đầu thực hiện',
        description:
            "Chuyển trạng thái 'ready' -> 'in_progress'. Người tiếp nhận là chính người gọi API " +
            "(lấy từ JWT), phải có actorRole LAB_STAFF và thuộc phòng Lab của nhiệm vụ. Bị từ chối " +
            "nếu bệnh nhân chưa thanh toán (paymentVerified = false / status = 'payment_pending'). " +
            'Việc chiếm task được thực hiện atomic ở tầng DB (compare-and-swap) — nếu 2 KTV cùng bấm ' +
            'nhận 1 task trống cùng lúc, chỉ 1 request thành công, request còn lại nhận 409 Conflict.',
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
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
    async receive(@Param('id') id: string, @CurrentUser('userId') receivingLabStaffId: string) {
        return this.labTaskService.receive(id, receivingLabStaffId);
    }

    /**
     * POST /lab-tasks/:id/report-exception
     * Phòng Lab báo cáo KHÔNG THỂ tiếp tục thực hiện (mẫu bị từ chối, bệnh nhân không có mặt...).
     * Người báo cáo là chính người gọi API (từ JWT) — không còn field `reportedByUserId` trong body.
     * Đây KHÔNG phải huỷ — task chỉ chuyển sang 'on_hold' và phát event để bác sĩ/module Order
     * quyết định bước tiếp theo (huỷ hẳn chỉ định, hoặc yêu cầu lấy lại mẫu).
     */
    @Post(':id/report-exception')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
        summary: 'Báo cáo ngoại lệ khiến phòng Lab không thể tiếp tục thực hiện',
        description:
            "Chuyển trạng thái sang 'on_hold' (trung gian, KHÔNG kết thúc) và phát event cho bác sĩ/" +
            'module Order biết để quyết định bước tiếp theo. Người gọi (từ JWT) phải có actorRole ' +
            'LAB_STAFF. Phòng Lab không có quyền tự huỷ chỉ định.',
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
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
     * DOCTOR trước khi thực hiện, vì đây là quyết định lâm sàng, không phải hành động của phòng Lab.
     */
    @Post(':id/resolve-exception')
    @UseGuards(JwtAuthGuard)
    @ApiOperation({
        summary: "Bác sĩ xử lý ngoại lệ đang 'on_hold' của 1 nhiệm vụ xét nghiệm",
        description:
            "'retry': quay về 'ready' để lấy lại mẫu/thực hiện lại (giữ nguyên paymentVerified, " +
            "xoá KTV/mốc thời gian tiếp nhận cũ). 'cancel': chuyển 'cancelled', dùng chung logic " +
            "với đường cascade từ module Order để không có 2 nguồn sự thật cho việc huỷ. Người gọi " +
            '(từ JWT) phải có actorRole DOCTOR.',
    })
    @ApiParam({ name: 'id', description: 'ID nhiệm vụ xét nghiệm (labTaskId)', format: 'uuid' })
    @ApiOkResponse({ description: "Nhiệm vụ sau khi xử lý (status = 'ready' hoặc 'cancelled')." })
    @ApiBadRequestResponse({ description: "Nhiệm vụ không ở trạng thái 'on_hold'." })
    @ApiForbiddenResponse({ description: 'Người gọi API không có actorRole DOCTOR.' })
    @ApiConflictResponse({
        description: 'Nhiệm vụ vừa được xử lý bởi một quyết định khác (race condition).',
    })
    @ApiNotFoundResponse({ description: 'Không tìm thấy nhiệm vụ xét nghiệm.' })
    async resolveException(
        @Param('id') id: string,
        @Body() dto: ResolveLabTaskExceptionDto,
        @CurrentUser('userId') resolvedByUserId: string,
    ) {
        return this.labTaskService.resolveException(id, dto, resolvedByUserId);
    }
}
