import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CaseOverviewService } from './case-overview.service';

/**
 * Module 5, mục "Xem thông tin & Đánh giá từ AI": bác sĩ xem toàn bộ hồ sơ điện tử của bệnh nhân
 * trước khi khám lâm sàng và ra chẩn đoán sơ bộ.
 */
@ApiTags('Doctor Examination - Case Overview')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('doctor-examination/encounters/:encounterId')
export class CaseOverviewController {
    constructor(private readonly caseOverviewService: CaseOverviewService) {}

    @Get('overview')
    @ApiOperation({
        summary: 'Tổng hợp hồ sơ bệnh án điện tử + đánh giá AI cho 1 lượt khám',
        description:
            'Bao gồm: thông tin cá nhân, tiền sử bệnh/dị ứng, sinh hiệu mới nhất, triệu chứng khai báo, ' +
            'bản tóm tắt do AI tạo (kèm nguồn tham chiếu), lịch sử hình ảnh y khoa đã AI phân tích ' +
            '(vùng bất thường được khoanh vùng), và chẩn đoán sơ bộ do AI đề xuất (kèm confidence score).',
    })
    @ApiParam({ name: 'encounterId', format: 'uuid' })
    @ApiOkResponse({ description: 'Toàn bộ dữ liệu tổng hợp cho 1 lượt khám.' })
    getOverview(@Param('encounterId') encounterId: string) {
        return this.caseOverviewService.getOverview(encounterId);
    }
}
