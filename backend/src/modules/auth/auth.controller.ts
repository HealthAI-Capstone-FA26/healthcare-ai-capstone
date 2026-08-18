import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // Bước 1: gửi OTP qua mail
  @Post('register')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng ký (gửi OTP)' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  // verify otp mfa
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xác thực OTP (tạo tài khoản)' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }
}