import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { DrugCatalogService } from './drug-catalog.service';
import { SearchDrugDto } from './dtos/search-drug.dto';

@ApiTags('Prescription - Drug Catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('prescriptions/drug-catalog')
export class DrugCatalogController {
    constructor(private readonly drugCatalogService: DrugCatalogService) {}

    @Get()
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.READ}:${Scope.ALL}`)
    @ApiOperation({ summary: 'Tìm kiếm danh mục thuốc theo tên/tên gốc/mã thuốc, có phân trang' })
    search(@Query() query: SearchDrugDto) {
        return this.drugCatalogService.search(query);
    }

    @Get(':drugId')
    @RequirePermissions(`${Resource.PRESCRIPTION}:${Action.READ}:${Scope.ALL}`)
    @ApiOperation({ summary: 'Chi tiết 1 thuốc kèm allergenCategory và các DrugInteraction liên quan' })
    findOne(@Param('drugId') drugId: string) {
        return this.drugCatalogService.findById(drugId);
    }
}
