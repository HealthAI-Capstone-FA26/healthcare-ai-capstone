import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { PatientAllergyService } from './patient-allergy.service';
import { CreatePatientAllergyDto } from './dto/create-patient-allergy.dto';
import { UpdatePatientAllergyStatusDto } from './dto/update-patient-allergy-status.dto';
import { FindPatientAllergyQueryDto } from './dto/find-patient-allergy-query.dto';

@ApiTags('Patient Allergy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class PatientAllergyController {
  constructor(private readonly patientAllergyService: PatientAllergyService) {}

  @Post('patients/:patientId/allergies')
  @RequirePermissions(`${Resource.ALLERGY}:${Action.CREATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Khai báo 1 dị ứng mới cho bệnh nhân (hồ sơ dài hạn, không gắn cứng 1 lượt khám)' })
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreatePatientAllergyDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.patientAllergyService.create(patientId, dto, user);
  }

  @Get('patients/:patientId/allergies')
  @RequirePermissions(`${Resource.ALLERGY}:${Action.READ}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Danh sách dị ứng đã ghi nhận của 1 bệnh nhân' })
  findByPatientId(@Param('patientId') patientId: string, @Query() query: FindPatientAllergyQueryDto) {
    return this.patientAllergyService.findByPatientId(patientId, query);
  }

  @Patch('allergies/:id/status')
  @RequirePermissions(`${Resource.ALLERGY}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Đổi trạng thái dị ứng (active/resolved/entered_in_error) — không sửa nội dung khác' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdatePatientAllergyStatusDto) {
    return this.patientAllergyService.updateStatus(id, dto);
  }
}
