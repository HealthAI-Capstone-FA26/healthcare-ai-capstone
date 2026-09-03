import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { PatientContactService } from './patient-contact.service';
import { CreateContactRequestDto } from './dto/create-contact-request.dto';
import { VerifyContactRequestOtpDto } from './dto/verify-contact-request-otp.dto';

// Không nhận patientId qua URL/param (tránh lộ patientId, dễ bị dò) — patient tương ứng
// được service tự tìm qua identityNumber trong body. Không còn accept/reject của chủ hồ
// sơ — chỉ còn 2 bước: gửi OTP -> verify OTP. Verify đúng là tạo thẳng người liên hệ.
@ApiTags('Patient Contact Requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('patients/contact-requests')
export class PatientContactController {
  constructor(private readonly patientContactService: PatientContactService) {}

  @Post()
  @ApiOperation({
    summary:
      'Bước 1: Gửi yêu cầu làm người liên hệ (không cần patientId — hệ thống tự tìm patient qua identityNumber + khớp đủ họ tên/ngày sinh/SĐT) + chọn kênh nhận OTP (email tự nhập hoặc sms tới SĐT patient)',
  })
  create(@Body() dto: CreateContactRequestDto, @CurrentUser() user: RequestUser) {
    return this.patientContactService.createContactRequest(user, dto);
  }

  @Post('verify-otp')
  @ApiOperation({
    summary: 'Bước 2: Nhập OTP đã nhận để xác thực — verify đúng sẽ tạo thẳng người liên hệ',
  })
  verifyOtp(@Body() dto: VerifyContactRequestOtpDto, @CurrentUser() user: RequestUser) {
    return this.patientContactService.verifyContactRequestOtp(user, dto);
  }
}