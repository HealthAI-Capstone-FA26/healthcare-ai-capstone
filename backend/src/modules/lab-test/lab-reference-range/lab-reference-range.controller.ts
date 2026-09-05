import { Controller, Get, Param, Query } from '@nestjs/common';
import {
    ApiBadRequestResponse,
    ApiNotFoundResponse,
    ApiOkResponse,
    ApiOperation,
    ApiParam,
    ApiTags,
} from '@nestjs/swagger';
import { LabReferenceRangeService } from './lab-reference-range.service';
import { LabReferenceRangeQueryDto } from './dtos/lab-reference-range-query.dto';

@ApiTags('Lab Reference Ranges')
@Controller('patients/:patientId/lab-reference-ranges')
export class LabReferenceRangeController {
    constructor(private readonly labReferenceRangeService: LabReferenceRangeService) {}

    /**
     * GET /patients/:patientId/lab-reference-ranges?testTypeId=...&at=...
     * Các dải ngưỡng (bình thường/thấp/trung bình/cao/nguy kịch) của từng tham số thuộc
     * 1 loại xét nghiệm, tính theo tuổi + giới tính của bệnh nhân — kỹ thuật viên gọi API này
     * khi mở form nhập kết quả để hiển thị ngay cạnh mỗi ô nhập.
     */
    @Get()
    @ApiOperation({
        summary: 'Ngưỡng tham chiếu các tham số của 1 loại xét nghiệm cho 1 bệnh nhân',
        description:
            'Trả về các dải nguy cơ (normal/low/medium/high/critical) của từng tham số, tính theo tuổi ' +
            '(tại thời điểm `at`) và giới tính của bệnh nhân.',
    })
    @ApiParam({ name: 'patientId', description: 'ID bệnh nhân', format: 'uuid' })
    @ApiOkResponse({ description: 'Danh sách ngưỡng tham chiếu theo từng tham số.' })
    @ApiNotFoundResponse({ description: 'Không tìm thấy bệnh nhân.' })
    @ApiBadRequestResponse({ description: 'Bệnh nhân chưa có ngày sinh, không thể xác định ngưỡng theo độ tuổi.' })
    async get(@Param('patientId') patientId: string, @Query() query: LabReferenceRangeQueryDto) {
        return this.labReferenceRangeService.getReferenceRanges(patientId, query.testTypeId, query.at);
    }
}
