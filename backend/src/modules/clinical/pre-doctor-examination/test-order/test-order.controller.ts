import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { ActorRolesGuard } from '../../../../common/guards/actor-roles.guard';
import { AllowActorRoles } from '../../../../common/decorators/actor-roles.decorator';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { ACTOR_ROLE } from '../../../../common/constants/actor-role.constant';
import { TestOrderService } from './test-order.service';
import { CreateTestOrderDto } from './dto/create-test-order.dto';
import { CancelTestOrderItemDto } from './dto/cancel-test-order-item.dto';

@ApiTags('Doctor Examination - Test Order')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, ActorRolesGuard)
@AllowActorRoles(ACTOR_ROLE.DOCTOR, ACTOR_ROLE.NURSE, ACTOR_ROLE.ADMIN)
@Controller('doctor-examination')
export class TestOrderController {
    constructor(private readonly testOrderService: TestOrderService) { }

    @Post('encounters/:encounterId/test-orders')
    @AllowActorRoles(ACTOR_ROLE.DOCTOR)
    @ApiOperation({
        summary: 'Chỉ định cận lâm sàng cho 1 lượt khám',
        description:
            'Bắt buộc dựa trên 1 chẩn đoán ban đầu (initial) của lượt khám. Mỗi hạng mục tự động khởi tạo 1 ' +
            'DiagnosticTask ở trạng thái payment_pending, bàn giao sang module lab-test. Lượt khám chuyển ' +
            "sang 'awaiting_diagnostics'. 409 nếu dịch vụ đã được chỉ định và chưa hoàn tất.",
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    create(
        @Param('encounterId', ParseUUIDPipe) encounterId: string,
        @Body() dto: CreateTestOrderDto,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.testOrderService.create(encounterId, dto, currentUserId);
    }

    @Get('encounters/:encounterId/test-orders')
    @ApiOperation({ summary: 'Danh sách chỉ định cận lâm sàng của 1 lượt khám' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    findByEncounterId(@Param('encounterId', ParseUUIDPipe) encounterId: string) {
        return this.testOrderService.findByEncounterId(encounterId);
    }

    @Get('test-orders/:orderId')
    @ApiOperation({ summary: 'Chi tiết 1 chỉ định cận lâm sàng' })
    @ApiParam({ name: 'orderId', format: 'uuid' })
    findById(@Param('orderId', ParseUUIDPipe) orderId: string) {
        return this.testOrderService.findById(orderId);
    }

    @Patch('test-order-items/:orderItemId/cancel')
    @AllowActorRoles(ACTOR_ROLE.DOCTOR)
    @ApiOperation({
        summary: 'Huỷ 1 hạng mục cận lâm sàng đã chỉ định',
        description:
            'Chỉ huỷ được khi nhiệm vụ chưa thực hiện (payment_pending | ready | on_hold); item và task được huỷ ' +
            'nguyên tử, sau đó phát sự kiện order-item.cancelled để lab-test tính lại trạng thái. 409 nếu phòng thực hiện đã bắt đầu.',
    })
    @ApiParam({ name: 'orderItemId', format: 'uuid' })
    @ApiOkResponse({ description: 'Hạng mục đã được đánh dấu cancelled.' })
    cancelItem(
        @Param('orderItemId', ParseUUIDPipe) orderItemId: string,
        @Body() dto: CancelTestOrderItemDto,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.testOrderService.cancelItem(orderItemId, dto, currentUserId);
    }
}
