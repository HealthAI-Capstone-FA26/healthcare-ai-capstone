import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { Icd10CatalogService } from './icd10-catalog.service';
import { SearchIcd10Dto } from './dto/search-icd10.dto';

@ApiTags('ICD-10 Catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('icd10-codes')
export class Icd10CatalogController {
    constructor(private readonly icd10CatalogService: Icd10CatalogService) {}

    @Get()
    @ApiOperation({ summary: 'Tìm kiếm danh mục ICD-10 theo mã hoặc tên bệnh' })
    @ApiOkResponse({ description: 'Danh sách mã ICD-10 khớp điều kiện tìm kiếm.' })
    search(@Query() query: SearchIcd10Dto) {
        return this.icd10CatalogService.search(query);
    }

    @Get(':code')
    @ApiOperation({ summary: 'Chi tiết 1 mã ICD-10' })
    @ApiParam({ name: 'code', description: 'Mã ICD-10, VD: J18.9' })
    getByCode(@Param('code') code: string) {
        return this.icd10CatalogService.getByCode(code);
    }
}
