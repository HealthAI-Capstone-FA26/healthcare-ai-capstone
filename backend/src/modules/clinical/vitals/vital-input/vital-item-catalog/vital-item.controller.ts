import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { VitalItemService } from './vital-item.service';

@ApiTags('Vital Items')
@Controller('vital-items')
export class VitalItemController {
    constructor(private readonly vitalItemService: VitalItemService) { }

    /**
     * GET /vital-items
     * Danh mục chỉ số sinh hiệu/thể trạng đang active — dùng để render form nhập liệu động
     * (tên hiển thị, đơn vị) thay vì hardcode danh sách chỉ số ở phía frontend.
     */
    @Get()
    @ApiOperation({
        summary: 'Danh mục chỉ số sinh hiệu / thể trạng',
        description:
            'Trả về danh sách các chỉ số đang active (tên hiển thị, đơn vị, mã LOINC) để giao diện điều dưỡng dựng form nhập liệu động thay vì hardcode.',
    })
    @ApiOkResponse({ description: 'Danh sách chỉ số sinh hiệu / thể trạng đang active.' })
    async list() {
        return this.vitalItemService.listActive();
    }
}
