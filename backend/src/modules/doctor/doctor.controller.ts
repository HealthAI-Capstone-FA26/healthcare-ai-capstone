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
// @UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('doctors')
export class DoctorController {
  constructor(private readonly doctorService: DoctorService) {}

  @Post()
  // @RequirePermissions(`${Resource.DOCTOR}:${Action.CREATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Tạo bác sĩ (chính thức hoặc thỉnh giảng) — chỉ admin' })
  create(@Body() dto: CreateDoctorDto) {
    return this.doctorService.create(dto);
  }

  @Get()
  // @RequirePermissions(`${Resource.DOCTOR}:${Action.READ}:${Scope.OWN}`)
  @ApiOperation({ summary: 'Danh sách bác sĩ, lọc theo khoa/tên (phục vụ chọn bác sĩ khi đặt lịch)' })
  findAll(@Query() query: SearchDoctorDto) {
    return this.doctorService.findAll(query);
  }

  @Get(':id')
  // @RequirePermissions(`${Resource.DOCTOR}:${Action.READ}:${Scope.OWN}`)
  @ApiOperation({ summary: 'Xem chi tiết bác sĩ' })
  findOne(@Param('id') id: string) {
    return this.doctorService.findById(id);
  }

  @Patch(':id')
  @RequirePermissions(`${Resource.DOCTOR}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Cập nhật thông tin bác sĩ — chỉ admin' })
  update(@Param('id') id: string, @Body() dto: UpdateDoctorDto) {
    return this.doctorService.update(id, dto);
  }
}
