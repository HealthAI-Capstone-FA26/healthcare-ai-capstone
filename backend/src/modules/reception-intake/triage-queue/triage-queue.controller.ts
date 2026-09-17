import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { TriageQueueService } from './triage-queue.service';
import { FindTriageQueueQueryDto } from './dto/find-triage-queue-query.dto';

// API READ-ONLY cho reception xem hàng đợi triage đã xếp (module3.md mục 5 PHASE 2 BƯỚC 2).
// KHÔNG có route call/start/done ở đây — đó là nghiệp vụ của module vitals khi xử lý hàng đợi,
// nằm ngoài phạm vi module reception-intake.
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

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết 1 entry trong hàng đợi triage' })
  findById(@Param('id') id: string) {
    return this.triageQueueService.findById(id);
  }
}
