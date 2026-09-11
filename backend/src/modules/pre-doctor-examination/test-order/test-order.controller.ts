import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { TestOrderService } from './test-order.service';
import { CreateTestOrderDto } from './dto/create-test-order.dto';
import { CancelTestOrderItemDto } from './dto/cancel-test-order-item.dto';

@ApiTags('Doctor Examination - Test Order')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('doctor-examination')
export class TestOrderController {
    constructor(private readonly testOrderService: TestOrderService) {}

    @Post('encounters/:encounterId/test-orders')
    @ApiOperation({
        summary: 'Chỉ định xét nghiệm cho 1 lượt khám',
        description:
            'Mỗi hạng mục chỉ định sẽ tự động khởi tạo 1 LabTask ở trạng thái payment_pending, bàn giao ' +
            'sang quy trình tiếp nhận xét nghiệm.',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    create(
        @Param('encounterId') encounterId: string,
        @Body() dto: CreateTestOrderDto,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.testOrderService.create(encounterId, dto, currentUserId);
    }

    @Get('encounters/:encounterId/test-orders')
    @ApiOperation({ summary: 'Danh sách chỉ định xét nghiệm của 1 lượt khám' })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    findByEncounterId(@Param('encounterId') encounterId: string) {
        return this.testOrderService.findByEncounterId(encounterId);
    }

    @Get('test-orders/:orderId')
    @ApiOperation({ summary: 'Chi tiết 1 chỉ định xét nghiệm' })
    @ApiParam({ name: 'orderId', format: 'uuid' })
    findById(@Param('orderId') orderId: string) {
        return this.testOrderService.findById(orderId);
    }

    @Patch('test-order-items/:orderItemId/cancel')
    @ApiOperation({
        summary: 'Huỷ 1 hạng mục xét nghiệm đã chỉ định',
        description: 'Phát sự kiện order-item.cancelled để cascade huỷ LabTask tương ứng bên module lab-test.',
    })
    @ApiParam({ name: 'orderItemId', format: 'uuid' })
    @ApiOkResponse({ description: 'Hạng mục đã được đánh dấu cancelled.' })
    cancelItem(
        @Param('orderItemId') orderItemId: string,
        @Body() dto: CancelTestOrderItemDto,
        @CurrentUser('userId') currentUserId: string,
    ) {
        return this.testOrderService.cancelItem(orderItemId, dto, currentUserId);
    }
}
