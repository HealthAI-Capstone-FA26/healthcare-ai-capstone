import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
@Controller('queue-tickets')
export class QueueTicketController {
  constructor(private readonly queueTicketService: QueueTicketService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Danh sách hàng đợi theo khoa/ngày/trạng thái, đã sắp theo thứ tự ưu tiên' })
  findMany(@Query() query: FindQueueTicketsQueryDto) {
    return this.queueTicketService.findMany(query);
  }

  // [MỚI] Bước 1 luồng at-hospital: bốc số trước, chưa cần thông tin bệnh nhân / appointment.
  @Post('at-hospital')
  @ApiOperation({
    summary: 'Bốc số at-hospital (prefix B): chỉ đưa vào hàng đợi, chưa tạo patient/appointment/encounter',
  })
  issueAtHospital() {
    return this.queueTicketService.issueWalkInTicket();
  }

  @Patch(':id/call')
  @UseGuards(JwtAuthGuard)
  // @RequirePermissions(`${Resource.QUEUE_TICKET}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Gọi số (chỉ reception staff)' })
  call(@Param('id') id: string, @Body() dto: CallQueueTicketDto) {
    return this.queueTicketService.call(id, dto);
  }

  @Patch(':id/done')
  @UseGuards(JwtAuthGuard)
  // @RequirePermissions(`${Resource.QUEUE_TICKET}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({
    summary:
      'Kết thúc lượt gọi số: tạo/gắn Appointment, tạo ReceptionCheckin và lập invoice phí khám pending. Encounter chỉ tạo sau khi invoice examination fee được thanh toán',
  })
  done(@Param('id') id: string, @Body() dto: ServeQueueTicketDto, @CurrentUser() user: RequestUser) {
    return this.queueTicketService.done(id, dto, user);
  }
}