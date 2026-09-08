import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Action, Resource, Scope } from '../../../common/constants/permissions.dictionary';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { PatientMedicalHistoryService } from './patient-medical-history.service';
import { CreatePatientMedicalHistoryDto } from './dto/create-patient-medical-history.dto';
import { UpdatePatientMedicalHistoryStatusDto } from './dto/update-patient-medical-history-status.dto';
import { FindPatientMedicalHistoryQueryDto } from './dto/find-patient-medical-history-query.dto';

@ApiTags('Patient Medical History')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class PatientMedicalHistoryController {
  constructor(private readonly patientMedicalHistoryService: PatientMedicalHistoryService) {}

  @Post('patients/:patientId/medical-history')
  @RequirePermissions(`${Resource.CONDITION}:${Action.CREATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Khai báo 1 tiền sử bệnh mới cho bệnh nhân (hồ sơ dài hạn, không gắn cứng 1 lượt khám)' })
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreatePatientMedicalHistoryDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.patientMedicalHistoryService.create(patientId, dto, user);
  }

  @Get('patients/:patientId/medical-history')
  @RequirePermissions(`${Resource.CONDITION}:${Action.READ}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Danh sách tiền sử bệnh đã ghi nhận của 1 bệnh nhân' })
  findByPatientId(
    @Param('patientId') patientId: string,
    @Query() query: FindPatientMedicalHistoryQueryDto,
  ) {
    return this.patientMedicalHistoryService.findByPatientId(patientId, query);
  }

  @Patch('medical-history/:id/status')
  @RequirePermissions(`${Resource.CONDITION}:${Action.UPDATE}:${Scope.ALL}`)
  @ApiOperation({ summary: 'Đổi trạng thái tiền sử bệnh (active/resolved/inactive) — không sửa nội dung khác' })
  updateStatus(@Param('id') id: string, @Body() dto: UpdatePatientMedicalHistoryStatusDto) {
    return this.patientMedicalHistoryService.updateStatus(id, dto);
  }
}
