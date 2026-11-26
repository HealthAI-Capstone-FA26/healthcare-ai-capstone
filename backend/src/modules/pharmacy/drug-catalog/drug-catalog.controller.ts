import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { DrugCatalogService } from './drug-catalog.service';
import { FindDrugsQueryDto } from './dtos/find-drugs-query.dto';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';

@ApiTags('Drug Catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('drugs')
export class DrugCatalogController {
    constructor(private readonly drugCatalogService: DrugCatalogService) {}

    @Get()
    @RequirePermissions(`${Resource.MEDICATION}:${Action.READ}:${Scope.GROUP}`)
    @ApiOperation({ summary: 'Danh sách / tìm kiếm thuốc trong danh mục phục vụ kê đơn' })
    @ApiOkResponse({ description: 'Danh sách thuốc khớp điều kiện tìm kiếm.' })
    findMany(@Query() query: FindDrugsQueryDto) {
        return this.drugCatalogService.findMany(query);
    }

    @Get('all')
    @RequirePermissions(`${Resource.MEDICATION}:${Action.READ}:${Scope.GROUP}`)
    @ApiOperation({ summary: 'Lấy toàn bộ danh sách thuốc trong hệ thống (không giới hạn số lượng)' })
    @ApiOkResponse({ description: 'Toàn bộ danh sách thuốc trong DrugCatalog.' })
    findAll() {
        return this.drugCatalogService.findAll();
    }

    @Get(':id')
    @RequirePermissions(`${Resource.MEDICATION}:${Action.READ}:${Scope.GROUP}`)
    @ApiOperation({ summary: 'Xem chi tiết 1 thuốc trong danh mục' })
    @ApiParam({ name: 'id', format: 'uuid', description: 'ID thuốc (drugId)' })
    @ApiOkResponse({ description: 'Thông tin chi tiết thuốc.' })
    findOne(@Param('id', ParseUUIDPipe) id: string) {
        return this.drugCatalogService.findById(id);
    }
}
