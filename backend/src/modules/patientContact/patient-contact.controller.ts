import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../auth/strategies/jwt.strategy';
import { PatientContactService } from './patient-contact.service';
import { CreateContactRequestDto } from './dto/create-contact-request.dto';

@ApiTags('Patient Contact Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('patients/:patientId/contact-requests')
export class PatientContactController {
  constructor(private readonly patientContactService: PatientContactService) {}

  @Post()
  @ApiOperation({
    summary:
      'Gửi yêu cầu làm người liên hệ của 1 patient đã có chủ (khớp identityNumber + phoneNumber)',
  })
  create(
    @Param('patientId') patientId: string,
    @Body() dto: CreateContactRequestDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.patientContactService.createContactRequest(patientId, user, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Danh sách request đang chờ duyệt của 1 patient (chỉ chủ hồ sơ)' })
  list(@Param('patientId') patientId: string, @CurrentUser() user: RequestUser) {
    return this.patientContactService.listContactRequests(patientId, user);
  }

  @Patch(':contactId/accept')
  @ApiOperation({ summary: 'Duyệt request làm người liên hệ (chỉ chủ hồ sơ)' })
  accept(
    @Param('patientId') patientId: string,
    @Param('contactId') contactId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.patientContactService.acceptContactRequest(patientId, contactId, user);
  }

  @Patch(':contactId/reject')
  @ApiOperation({ summary: 'Từ chối request làm người liên hệ (chỉ chủ hồ sơ)' })
  reject(
    @Param('patientId') patientId: string,
    @Param('contactId') contactId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.patientContactService.rejectContactRequest(patientId, contactId, user);
  }
}
