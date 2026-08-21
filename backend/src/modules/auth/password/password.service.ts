import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { UserService } from '../../user/user.service';
import { MailService } from '../../mail/mail.service';
import { SessionService } from '../session/session.service';
import { TokenService } from '../token/token.service';
import { PasswordResetOtpStore } from './password-reset-otp.store';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { VerifyForgotPasswordOtpDto } from '../dto/verify-forgot-password-otp.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { RESET_PASSWORD_PURPOSE, SALT_ROUNDS } from '../common/auth.constants';
import { generateOtp, hashOtp, otpExpiryDate } from '../common/otp.util';
import { assertOtpValid } from '../common/otp-validation.util';

// ================== ĐỔI MẬT KHẨU & QUÊN MẬT KHẨU (3 bước) ==================
@Injectable()
export class PasswordService {
  constructor(
    private readonly userService: UserService,
    private readonly mailService: MailService,
    private readonly sessionService: SessionService,
    private readonly tokenService: TokenService,
    private readonly passwordResetOtpStore: PasswordResetOtpStore,
    private readonly configService: ConfigService,
  ) {}

  private getOtpExpiryMinutes(): number {
    return Number(this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? 5);
  }

  // ================== CHANGE PASSWORD (user đã đăng nhập) ==================
  async changePassword(userId: string, dto: ChangePasswordDto) {
    if (dto.newPassword !== dto.confirmNewPassword) {
      throw new BadRequestException('Mật khẩu mới và mật khẩu xác nhận không khớp');
    }

    const user = await this.userService.findById(userId);
    if (!user) {
      throw new BadRequestException('Người dùng không tồn tại');
    }

    const isOldPasswordValid = await bcrypt.compare(dto.oldPassword, user.passwordHash);
    if (!isOldPasswordValid) {
      throw new UnauthorizedException('Mật khẩu hiện tại không chính xác');
    }

    if (dto.oldPassword === dto.newPassword) {
      throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại');
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.userService.updatePassword(userId, newPasswordHash);

    // Đổi mật khẩu -> revoke tất cả session đang dùng
    await this.sessionService.revokeByUserId(userId);

    return { message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại' };
  }

  // ================== FORGOT PASSWORD (bước 1: gửi OTP) ==================
  async forgotPassword(dto: ForgotPasswordDto) {
    const genericMessage = 'Nếu email tồn tại trong hệ thống, mã OTP đã được gửi tới email của bạn';
    const user = await this.userService.findByEmail(dto.email);

    // Không tiết lộ email có tồn tại hay không, tránh dò email hệ thống
    if (!user) {
      return { message: genericMessage };
    }

    const otp = generateOtp();
    const otpCodeHash = await hashOtp(otp);
    const otpExpiresAt = otpExpiryDate(this.getOtpExpiryMinutes());

    await this.passwordResetOtpStore.upsert(user.userId, {
      userId: user.userId,
      otpCodeHash,
      otpExpiresAt,
      verified: false,
    });
    await this.mailService.sendPasswordResetOtpMail(user.email, otp);

    return { message: genericMessage };
  }

  // ================== FORGOT PASSWORD (bước 2: verify OTP -> cấp resetToken) ==================
  async verifyForgotPasswordOtp(dto: VerifyForgotPasswordOtpDto) {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException('Yêu cầu đặt lại mật khẩu không hợp lệ');
    }

    const pending = await this.passwordResetOtpStore.find(user.userId);
    if (!pending) {
      throw new BadRequestException('Không tìm thấy yêu cầu đặt lại mật khẩu, vui lòng thử lại');
    }

    await assertOtpValid(
      pending,
      dto.otp,
      {
        expired: 'Mã OTP đã hết hạn, vui lòng yêu cầu lại',
        maxAttemptsExceeded: 'Bạn đã nhập sai OTP quá số lần cho phép, vui lòng yêu cầu lại',
        invalidOtp: 'Mã OTP không chính xác',
      },
      {
        onExpiredOrMaxAttempts: () => this.passwordResetOtpStore.delete(user.userId),
        onWrongAttempt: () => this.passwordResetOtpStore.incrementAttempts(user.userId).then(() => undefined),
      },
    );

    await this.passwordResetOtpStore.markVerified(user.userId);

    const resetTokenTtlMins = Number(this.configService.get('RESET_TOKEN_TTL_MINUTES') ?? 10);
    const resetToken = this.tokenService.signResetToken(user.userId, RESET_PASSWORD_PURPOSE, resetTokenTtlMins);

    return { message: 'Xác thực OTP thành công, mời bạn đặt mật khẩu mới', resetToken };
  }

  // ================== FORGOT PASSWORD (bước 3: đặt mật khẩu mới, nhập 2 lần) ==================
  async resetPassword(dto: ResetPasswordDto) {
    if (dto.newPassword !== dto.confirmNewPassword) {
      throw new BadRequestException('Mật khẩu mới và mật khẩu xác nhận không khớp');
    }

    let payload: { sub: string; purpose: string };
    try {
      payload = this.tokenService.verifyResetToken(dto.resetToken);
    } catch {
      throw new UnauthorizedException(
        'Reset token không hợp lệ hoặc đã hết hạn, vui lòng yêu cầu lại OTP',
      );
    }

    if (payload.purpose !== RESET_PASSWORD_PURPOSE) {
      throw new UnauthorizedException('Reset token không hợp lệ');
    }

    // Bắt buộc phải đã verify OTP trước đó mới cho đổi mật khẩu
    const pending = await this.passwordResetOtpStore.find(payload.sub);
    if (!pending || !pending.verified) {
      throw new UnauthorizedException('Bạn cần xác thực OTP trước khi đặt lại mật khẩu');
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.userService.updatePassword(payload.sub, newPasswordHash);
    await this.passwordResetOtpStore.delete(payload.sub);

    // Đổi mật khẩu -> revoke tất cả session đang dùng
    await this.sessionService.revokeByUserId(payload.sub);

    return { message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại' };
  }
}
