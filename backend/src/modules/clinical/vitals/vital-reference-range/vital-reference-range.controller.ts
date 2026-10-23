import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags, ApiBadRequestResponse, ApiNotFoundResponse } from '@nestjs/swagger';
import { VitalReferenceRangeService } from './vital-reference-range.service';
import { ReferenceRangeQueryDto } from '../vital-input/dtos/reference-range-query.dto';

@ApiTags('Vital Reference Ranges')
@Controller('patients/:patientId/vital-reference-ranges')
export class VitalReferenceRangeController {
    constructor(private readonly vitalReferenceRangeService: VitalReferenceRangeService) { }

    /**
     * GET /patients/:patientId/vital-reference-ranges?measuredAt=2026-09-05
     * Khoảng bình thường/nguy kịch của từng chỉ số cho riêng bệnh nhân này (theo tuổi + giới tính) —
     * giao diện điều dưỡng gọi API này khi mở form nhập để hiển thị range ngay cạnh mỗi ô,
     * thay vì chỉ biết bất thường sau khi đã submit.
     */
    @Get()
    @ApiOperation({
        summary: 'Khoảng bình thường / nguy kịch của các chỉ số cho 1 bệnh nhân',
        description:
            'Trả về khoảng bình thường và nguy kịch của từng chỉ số sinh hiệu, tính theo tuổi (tại measuredAt) và giới tính ' +
            'của bệnh nhân — dùng để hiển thị ngay cạnh ô nhập trên form của điều dưỡng.',
    })
    @ApiParam({ name: 'patientId', description: 'ID bệnh nhân', format: 'uuid' })
    @ApiQuery({
        name: 'measuredAt',
        required: false,
        description: 'Thời điểm tính tuổi để tra ngưỡng (ISO 8601). Mặc định là thời điểm gọi API.',
    })
    @ApiOkResponse({ description: 'Danh sách khoảng bình thường/nguy kịch theo từng chỉ số.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy bệnh nhân.' })
    @ApiBadRequestResponse({ description: 'Bệnh nhân chưa có ngày sinh, không thể xác định khoảng theo độ tuổi.' })
    async get(@Param('patientId') patientId: string, @Query() query: ReferenceRangeQueryDto) {
        return this.vitalReferenceRangeService.getReferenceRanges(patientId, query.measuredAt);
    }
}
