import { Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { TriageQueueService } from './triage-queue.service';
import { FindTriageQueueQueryDto } from './dto/find-triage-queue-query.dto';

// GET: reception xem hàng đợi triage đã xếp (module3.md mục 5 PHASE 2 BƯỚC 2).
// POST dequeue / PATCH :id/start: y tá (module vitals) gọi bệnh nhân + bắt đầu đo. Bước hoàn tất
// (in_progress -> done) KHÔNG có route riêng — chạy trong cùng transaction với ghi nhận sinh hiệu
// (POST /vital-sessions kèm queueEntryId, xem TriageQueueService.complete).
@ApiTags('Triage Queue')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('triage-queue')
export class TriageQueueController {
  constructor(private readonly triageQueueService: TriageQueueService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách hàng đợi triage theo khoa/ngày/trạng thái, đã sắp theo thứ tự ưu tiên' })
  findMany(@Query() query: FindTriageQueueQueryDto) {
    return this.triageQueueService.findMany(query);
  }

  @Post('dequeue')
  @ApiOperation({
    summary:
      'Y tá gọi bệnh nhân tiếp theo trong hàng đợi triage của mình theo thứ tự ưu tiên (waiting -> called)',
  })
  dequeue(@CurrentUser() user: RequestUser) {
    return this.triageQueueService.dequeue(user.userId);
  }

  @Patch(':id/start')
  @ApiOperation({ summary: 'Y tá bắt đầu đo sinh hiệu cho bệnh nhân đã gọi (called -> in_progress)' })
  start(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.triageQueueService.startProcessing(id, user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết 1 entry trong hàng đợi triage' })
  findById(@Param('id') id: string) {
    return this.triageQueueService.findById(id);
  }
}