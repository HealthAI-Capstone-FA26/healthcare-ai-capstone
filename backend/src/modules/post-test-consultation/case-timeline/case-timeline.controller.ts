import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CaseTimelineService } from './case-timeline.service';

/**
 * Module 8, mục "Tổng hợp tiến trình bệnh án". Chỉ đọc — mọi user đã đăng nhập (bác sĩ, điều
 * dưỡng...) đều xem được, không assert actorRole cụ thể, cùng cách CaseOverviewController
 * (Module 5) đang làm.
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
            'Gồm: thông tin bệnh nhân, tiền sử/dị ứng (hồ sơ dài hạn), và dòng thời gian đã gộp & sắp ' +
            'xếp tăng dần theo thời điểm thực tế: lý do khám, các lần đo sinh hiệu, khám lâm sàng, các ' +
            'chỉ định xét nghiệm, kết quả xét nghiệm vừa thực hiện, các chẩn đoán (sơ bộ & chính thức), ' +
            'và tư vấn điều trị (nếu đã có).',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: 'Toàn bộ dữ liệu tổng hợp + dòng thời gian cho 1 lượt khám.' })
    getTimeline(@Param('encounterId') encounterId: string) {
        return this.caseTimelineService.getTimeline(encounterId);
    }
}
