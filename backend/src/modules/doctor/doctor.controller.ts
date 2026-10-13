import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DoctorService } from './doctor.service';
import { CreateDoctorDto } from './dto/create-doctor.dto';
import { UpdateDoctorDto } from './dto/update-doctor.dto';
import { SearchDoctorDto } from './dto/search-doctor.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../common/constants/permissions.dictionary';

@ApiTags('Doctors')
@ApiBearerAuth()
@Controller('doctors')
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Post()
  // @UseGuards(JwtAuthGuard, PermissionsGuard)
  // @RequirePermissions(`${Resource.DOCTOR}:${Action.CREATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Tạo bác sĩ (chính thức hoặc thỉnh giảng) — chỉ admin' })
  create(@Body() dto: CreateDoctorDto) {
    return this.doctorService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách bác sĩ công khai (Public API - phục vụ khách & bệnh nhân chọn bác sĩ)' })
  findAll(@Query() query: SearchDoctorDto) {
    return this.doctorService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Xem chi tiết thông tin bác sĩ công khai (Public API)' })
  findOne(@Param('id') id: string) {
    return this.doctorService.findById(id);
  }

  @Patch(':id')
  // @UseGuards(JwtAuthGuard, PermissionsGuard)
  // @RequirePermissions(`${Resource.DOCTOR}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Cập nhật thông tin bác sĩ — chỉ admin' })
  update(@Param('id') id: string, @Body() dto: UpdateDoctorDto) {
    return this.doctorService.update(id, dto);
  }
}
