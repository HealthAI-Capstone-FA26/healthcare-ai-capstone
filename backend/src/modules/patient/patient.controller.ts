import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PatientService } from './patient.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { UpdatePatientDto } from './dto/update-patient.dto';
import { SearchPatientDto } from './dto/search-patient.dto';
import { MatchSuggestionQueryDto } from './dto/match-suggestion-query.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser, RequestUser } from '../../common/decorators/current-user.decorator';
import { Action, Resource, Scope } from '../../common/constants/permissions.dictionary';

@ApiTags('Patients')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('patients')
export class PatientController {
  constructor(private readonly patientService: PatientService) {}

  @Post()
  // @RequirePermissions(`${Resource.PATIENT}:${Action.CREATE}:${Scope.OWN}`)
    @ApiOperation({
    summary:
      'Tạo hồ sơ bệnh nhân (lễ tân tạo tại quầy -> userId=null, hoặc user tự tạo hồ sơ cho mình)',
  })
  create(@Body() dto: CreatePatientDto, @CurrentUser() user: RequestUser) {
    return this.patientService.create(dto, user);
  }

  @Get()
  // @RequirePermissions(`${Resource.PATIENT}:${Action.READ}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Tìm kiếm bệnh nhân theo tên/CCCD/mã bệnh nhân (lễ tân/admin)' })
  search(@Query() query: SearchPatientDto) {
    return this.patientService.search(query);
  }

  @Get('match-suggestion')
  // @RequirePermissions(`${Resource.PATIENT}:${Action.READ}:${Scope.OWN}`)
  @ApiOperation({
    summary: 'Gợi ý hồ sơ bệnh nhân khớp với user hiện tại (dùng ngay sau khi đăng ký) patient có user_id == null',
  })
  findMatchSuggestion(
    @CurrentUser() user: RequestUser,
    @Query() query: MatchSuggestionQueryDto,
  ) {
    return this.patientService.findMatchSuggestion(user, query);
  }

  @Get(':id')
  // @RequirePermissions(`${Resource.PATIENT}:${Action.READ}:${Scope.OWN}`)
  @ApiOperation({ summary: 'Xem chi tiết hồ sơ bệnh nhân' })
  findOne(@Param('id') id: string) {
    return this.patientService.findById(id);
  }

  @Patch(':id')
  @RequirePermissions(`${Resource.PATIENT}:${Action.UPDATE}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Cập nhật hồ sơ bệnh nhân (lễ tân/admin)' })
  update(@Param('id') id: string, @Body() dto: UpdatePatientDto) {
    return this.patientService.update(id, dto);
  }

  @Post(':id/link-user')
  @RequirePermissions(`${Resource.PATIENT}:${Action.UPDATE}:${Scope.OWN}`)
  @ApiOperation({
    summary: 'Liên kết hồ sơ bệnh nhân với tài khoản hiện tại (tự động tạo kèm contact self)',
  })
  linkUser(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.patientService.linkUser(id, user);
  }

}
