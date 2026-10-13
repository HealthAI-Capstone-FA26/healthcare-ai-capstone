import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CaseTimelineService } from './case-timeline.service';

/**
 * SE05, "Tổng hợp tiến trình bệnh án". Chỉ đọc — mọi user đã đăng nhập đều xem được (không assert actorRole), cùng
 * cách CaseOverviewController (SE02).
 */
@ApiTags('Post-Test Consultation - Case Timeline')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('post-test-consultation/encounters/:encounterId')
export class CaseTimelineController {
    constructor(private readonly caseTimelineService: CaseTimelineService) {}

    @Get('timeline')
    @ApiOperation({
        summary: 'Tổng hợp hồ sơ bệnh án theo trình tự thời gian (timeline) cho 1 lượt khám',
        description:
            'Gồm: bệnh nhân, tiền sử/dị ứng (hồ sơ dài hạn), tiến độ cận lâm sàng, cờ readyForConclusion, các cảnh báo ' +
            'còn mở (chỉ số nguy hiểm, bất thường ECG) và dòng thời gian tăng dần theo thời điểm thực tế: lý do khám, ' +
            'sinh hiệu, khám lâm sàng, chẩn đoán (ban đầu / phân biệt / chính thức), chỉ định cận lâm sàng, kết quả ' +
            '(xét nghiệm máu, ECG, siêu âm tim, X-quang), bản ghi ECG + phân tích AI, và tư vấn điều trị (nếu có).',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: 'Toàn bộ dữ liệu tổng hợp + dòng thời gian cho 1 lượt khám.' })
    getTimeline(@Param('encounterId') encounterId: string) {
        return this.caseTimelineService.getTimeline(encounterId);
    }
}
