import { Body, Controller, HttpCode, HttpStatus, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RegistrationService } from './registration/registration.service';
import { LoginService } from './login/login.service';
import { PasswordService } from './password/password.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyLoginOtpDto } from './dto/verify-login-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyForgotPasswordOtpDto } from './dto/verify-forgot-password-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FileInterceptor } from '@nestjs/platform-express';
import { imageUploadConfig, uploadImageToS3 } from 'src/common/configs/upload.config';

// Controller chỉ làm nhiệm vụ định tuyến HTTP -> gọi service theo đúng domain
// (registration / login / password). Không còn 1 "AuthService" khổng lồ ôm hết.
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registrationService: RegistrationService,
    private readonly loginService: LoginService,
    private readonly passwordService: PasswordService,
  ) { }

  // ================== REGISTER (2 bước: gửi OTP -> verify OTP) ==================

  @Post('register')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('avatar', imageUploadConfig)) // Interceptor nhận file 'avatar'
  @ApiConsumes('multipart/form-data')
  async register(
    @Body() dto: RegisterDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    let avatarUrl: string | undefined = undefined;

    // Nếu có gửi file avatar -> đẩy thẳng lên MinIO S3
    if (file) {
      const uploadResult = await uploadImageToS3(file, 'avatars');
      avatarUrl = uploadResult.objectName; // Hoặc URL đầy đủ đến MinIO
    }

    return this.registrationService.register({
      ...dto,
      avatarUrl,
    });
  }

  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xác thực OTP (tạo tài khoản)' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.registrationService.verifyOtp(dto);
  }

  // ================== LOGIN (2 bước: password + MFA OTP) ==================

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập bước 1: xác thực email + password, gửi OTP' })
  login(@Body() dto: LoginDto) {
    return this.loginService.login(dto);
  }

  @Post('login/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng nhập bước 2: xác thực OTP, trả về access/refresh token' })
  verifyLoginOtp(@Body() dto: VerifyLoginOtpDto) {
    return this.loginService.verifyLoginOtp(dto);
  }

  @Post('refresh-token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cấp lại access token mới bằng refresh token' })
  refreshToken(@Body() dto: RefreshTokenDto) {
    return this.loginService.refreshToken(dto);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đăng xuất, thu hồi session hiện tại' })
  logout(@CurrentUser('userId') userId: string) {
    return this.loginService.logout(userId);
  }

  // ================== CHANGE PASSWORD ==================

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Đổi mật khẩu (yêu cầu đăng nhập), thu hồi toàn bộ session' })
  changePassword(@CurrentUser('userId') userId: string, @Body() dto: ChangePasswordDto) {
    return this.passwordService.changePassword(userId, dto);
  }

  // ================== FORGOT PASSWORD (3 bước: gửi OTP -> verify OTP -> đặt mật khẩu mới) ==================

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quên mật khẩu bước 1: gửi OTP qua mail' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordService.forgotPassword(dto);
  }

  @Post('forgot-password/verify-otp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quên mật khẩu bước 2: xác thực OTP, nhận resetToken' })
  verifyForgotPasswordOtp(@Body() dto: VerifyForgotPasswordOtpDto) {
    return this.passwordService.verifyForgotPasswordOtp(dto);
  }

  @Post('forgot-password/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quên mật khẩu bước 3: đặt mật khẩu mới (nhập + xác nhận)' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwordService.resetPassword(dto);
  }
}
