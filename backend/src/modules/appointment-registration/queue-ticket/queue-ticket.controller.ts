import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { QueueTicketService } from './queue-ticket.service';
import { FindQueueTicketsQueryDto } from './dto/find-queue-tickets-query.dto';
import { CallQueueTicketDto } from './dto/call-queue-ticket.dto';
import { ServeQueueTicketDto } from './dto/serve-queue-ticket.dto';

@ApiTags('Queue Ticket')
@ApiBearerAuth()
// @UseGuards(JwtAuthGuard, PermissionsGuard)
@UseGuards(JwtAuthGuard)
@Controller('queue-tickets')
export class QueueTicketController {
  constructor(private readonly queueTicketService: QueueTicketService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách hàng đợi theo khoa/ngày/trạng thái, đã sắp theo thứ tự ưu tiên' })
  findMany(@Query() query: FindQueueTicketsQueryDto) {
    return this.queueTicketService.findMany(query);
  }

  @Patch(':id/call')
  // @RequirePermissions(`${Resource.QUEUE_TICKET}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Gọi số (chỉ reception staff)' })
  call(@Param('id') id: string, @Body() dto: CallQueueTicketDto) {
    return this.queueTicketService.call(id, dto);
  }

  @Patch(':id/serve')
  // @RequirePermissions(`${Resource.QUEUE_TICKET}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({
    summary: 'Tiếp nhận: tạo ReceptionCheckin, gán bác sĩ, chuyển Appointment sang checked_in',
  })
  serve(@Param('id') id: string, @Body() dto: ServeQueueTicketDto, @CurrentUser() user: RequestUser) {
    return this.queueTicketService.serve(id, dto, user);
  }

  @Patch(':id/done')
  // @RequirePermissions(`${Resource.QUEUE_TICKET}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Đánh dấu hoàn tất tiếp nhận, sẵn sàng bàn giao Module 3' })
  done(@Param('id') id: string) {
    return this.queueTicketService.done(id);
  }
}
