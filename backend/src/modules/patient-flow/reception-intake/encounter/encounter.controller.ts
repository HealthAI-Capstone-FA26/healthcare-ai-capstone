import { Body, Controller, Get, Param, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { SendEncounterPdfZaloDto } from './dto/send-encounter-pdf-zalo.dto';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../../identity-access/auth/strategies/jwt.strategy';
import { EncounterService } from './encounter.service';
import { EncounterPdfService } from './encounter-pdf.service';
import { FindEncountersQueryDto } from './dto/find-encounter-query.dto';
import { EncounterDoctorRoutingService } from './encounter-doctor-routing.service';
import { PermissionsGuard } from '../../../../common/guards/permissions.guard';
import { RequirePermissions } from '../../../../common/decorators/permissions.decorator';
import { Action, Resource, Scope } from '../../../../common/constants/permissions.dictionary';

@ApiTags('Encounter')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('encounters')
export class EncounterController {
  constructor(
    private readonly encounterService: EncounterService,
    private readonly encounterPdfService: EncounterPdfService,
    private readonly encounterDoctorRoutingService: EncounterDoctorRoutingService,
  ) { }

  @Get()
  @RequirePermissions(`${Resource.ENCOUNTER}:${Action.READ}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Danh sách lượt khám theo bệnh nhân/trạng thái, sắp xếp mới nhất trước' })
  findMany(@Query() query: FindEncountersQueryDto) {
    return this.encounterService.findMany(query);
  }

  @Get(':id')
  @RequirePermissions(`${Resource.ENCOUNTER}:${Action.READ}:${Scope.GROUP}`)
  @ApiOperation({
    summary: 'Chi tiết 1 lượt khám kèm lý do khám, lịch sử xác minh danh tính, hàng chờ bác sĩ, đồng ý',
  })
  findById(@Param('id') id: string) {
    return this.encounterService.findById(id);
  }

  @Get(':id/export-pdf')
  @RequirePermissions(`${Resource.ENCOUNTER}:${Action.READ}:${Scope.GROUP}`)
  @ApiOperation({ summary: 'Xuất PDF thông tin lượt khám (bệnh nhân, bác sĩ, lý do khám, sinh hiệu)' })
  @ApiParam({ name: 'id', format: 'uuid' })
  async exportPdf(@Param('id') id: string): Promise<StreamableFile> {
    const { buffer, filename } = await this.encounterPdfService.generate(id);
    return new StreamableFile(buffer, {
      type: 'application/pdf',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Post(':id/send-pdf-zalo')
  @RequirePermissions(`${Resource.ENCOUNTER}:${Action.UPDATE}:${Scope.GROUP}`)
  @ApiOperation({
    summary: '[TEST] Xuất PDF lượt khám và gửi qua Zalo OA (không cần complete-registration); trả lỗi chi tiết nếu thất bại',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  sendPdfZalo(@Param('id') id: string, @Body() dto: SendEncounterPdfZaloDto) {
    return this.encounterPdfService.sendToZaloForTest(id, dto?.zaloUserId);
  }

  @Post(':id/complete-registration')
  @RequirePermissions(`${Resource.ENCOUNTER}:${Action.UPDATE}:${Scope.GROUP}`)
  @ApiOperation({
    summary:
      'Hoàn tất thủ tục tiếp đón: kiểm tra đủ chief complaint + xác minh danh tính + consent bắt buộc, chuyển Encounter sang registered và xếp vào hàng đợi triage cho module vitals',
  })
  completeRegistration(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    return this.encounterService.completeRegistration(id, user);
  }

  @Post('from-paid-appointment/:appointmentId')
  @RequirePermissions(`${Resource.ENCOUNTER}:${Action.CREATE}:${Scope.GROUP}`)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Tạo Encounter sau khi examination fee của Appointment đã thanh toán',
  })
  createFromPaidAppointment(@Param('appointmentId') appointmentId: string) {
    return this.encounterService.createAfterPaidConsultation(appointmentId);
  }

  @Post(':id/route-doctor')
  @RequirePermissions(`${Resource.ENCOUNTER}:${Action.UPDATE}:${Scope.GROUP}`)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Điều phối bệnh nhân sau khi đã đo sinh hiệu: tự chọn bác sĩ đang trong ca có ít bệnh nhân chờ nhất và xếp vào hàng đợi',
    description:
      'Chỉ NURSE / RECEPTIONIST / ADMIN. Lượt khám phải đang registered hoặc waiting_for_doctor và đã có ít nhất 1 ' +
      'phiên sinh hiệu và CHƯA có DoctorQueueEntry. Bác sĩ được chọn theo số DoctorQueueEntry (waiting/called/in_progress) ' +
      'trong ngày ít nhất; hoà thì chọn ngẫu nhiên đều. Không có bác sĩ nào đang trong ca -> 400 và không thay đổi gì.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  routeToDoctor(
    @Param('id') id: string,
    @CurrentUser('userId') currentUserId: string,
  ): Promise<any> {
    return this.encounterDoctorRoutingService.routeToDoctor(id, currentUserId);
  }

  @Post(':id/finish')
  @RequirePermissions(`${Resource.ENCOUNTER}:${Action.UPDATE}:${Scope.GROUP}`)
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Kết thúc lượt khám sau khi tư vấn / kê đơn: chuyển Encounter sang finished, Appointment sang completed, DoctorQueueEntry sang done và gửi PDF lượt khám qua Zalo',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  async finish(@Param('id') id: string, @CurrentUser() user: RequestUser) {
    const result = await this.encounterService.finishEncounter(id, user);
    // Gửi PDF thông tin lượt khám qua Zalo và email hướng dẫn đăng ký tài khoản nếu chưa liên kết (best-effort).
    const [pdfDelivery, portalGuideEmail] = await Promise.all([
      this.encounterPdfService.sendViaZalo(id, result.encounter.patientId),
      this.encounterService.sendPortalGuideEmailIfUnlinked(result.encounter.patientId),
    ]);
    return { ...result, pdfDelivery, portalGuideEmail };
  }
}
