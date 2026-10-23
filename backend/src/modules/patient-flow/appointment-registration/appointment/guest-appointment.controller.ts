import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GuestAppointmentService } from './guest-appointment.service';
import { GuestRequestOtpDto } from './dto/guest-request-otp.dto';
import { GuestVerifyOtpDto } from './dto/guest-verify-otp.dto';

// Đặt lịch cho khách vãng lai (chưa có tài khoản) — KHÔNG gắn JwtAuthGuard, ai cũng gọi được.
// Flow: request-otp (thông tin đặt lịch + chọn kênh nhận OTP) -> verify-otp (nhập OTP + email nếu có). Verify đúng sẽ:
// - Match đủ 3 field (fullName/phoneNumber/identityNumber) với 1 patient status='main' có sẵn
//   -> tạo Appointment với suggestedPatientId, patientId để null (chờ lễ tân đối chiếu qua
//   POST /appointment/sync-patient).
// - Không đủ 3 field khớp -> tạo Patient status='draft' + Appointment với patientId luôn.
@ApiTags('Guest Appointment')
@Controller('appointments/guest')
export class GuestAppointmentController {
  constructor(private readonly guestAppointmentService: GuestAppointmentService) {}

  @Post('request-otp')
  @ApiOperation({
    summary:
      'Bước 1: Khách vãng lai chọn khoa, bác sĩ, slot, nhập thông tin đặt lịch và chọn kênh nhận OTP (email/sms)',
  })
  requestOtp(@Body() dto: GuestRequestOtpDto) {
    return this.guestAppointmentService.requestOtp(dto);
  }

  @Post('verify-otp')
  @ApiOperation({
    summary:
      'Bước 2: Nhập OTP và email để xác nhận — verify đúng sẽ match/tạo Patient rồi tạo Appointment từ thông tin đã lưu',
  })
  verifyOtp(@Body() dto: GuestVerifyOtpDto) {
    return this.guestAppointmentService.verifyOtp(dto);
  }
}
