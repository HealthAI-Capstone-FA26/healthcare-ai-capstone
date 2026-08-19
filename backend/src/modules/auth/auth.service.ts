import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { UserService } from '../user/user.service';
import { RegistrationOtpService } from './registration-otp.service';
import { LoginOtpService } from './login-otp.service';
import { PasswordResetOtpService } from './password-reset-otp.service';
import { SessionService } from './session.service';
import { SecurityConfigService } from './security-config.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyLoginOtpDto } from './dto/verify-login-otp.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { VerifyForgotPasswordOtpDto } from './dto/verify-forgot-password-otp.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

const SALT_ROUNDS = 10;
const OTP_LENGTH = 6;
const MAX_OTP_ATTEMPTS = 5;
const DEFAULT_ACTOR_ROLE = 'patient';
const RESET_PASSWORD_PURPOSE = 'password_reset';

interface RefreshTokenPayload {
  sub: string;
}

interface ResetTokenPayload {
  sub: string;
  purpose: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly registrationOtpService: RegistrationOtpService,
    private readonly loginOtpService: LoginOtpService,
    private readonly passwordResetOtpService: PasswordResetOtpService,
    private readonly sessionService: SessionService,
    private readonly securityConfigService: SecurityConfigService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {}

  private generateOtp(): string {
    return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');// tạo mã otp có OTP_LENGHT chữ số
  }

  private getOtpExpiryMinutes(): number {
    return Number(this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? 5);
  }

  private getRefreshTokenSecret(): string {
    return this.configService.getOrThrow<string>('REFRESH_TOKEN_SECRET');
  }

  private getResetPasswordSecret(): string {
    return this.configService.getOrThrow<string>('RESET_PASSWORD_SECRET');
  }

  // Sinh cặp access token (ngắn hạn) + refresh token (dài hạn hơn), đồng thời tạo/replace session trong DB
  private async issueTokens(user: { userId: string; email: string }) {
    const config = await this.securityConfigService.getConfig();

    const accessToken = this.jwtService.sign(
      { sub: user.userId, email: user.email },
      { expiresIn: `${config.accessTokenTtlMins}m` },
    );

    const refreshToken = this.jwtService.sign(
      { sub: user.userId },
      { secret: this.getRefreshTokenSecret(), expiresIn: `${config.refreshTokenTtlHours}h` },
    );

    // expiredAt của session = session_limit tuyệt đối tính từ thời điểm đăng nhập này
    await this.sessionService.createSession(user.userId, refreshToken, config.maxSessionHours);

    return { accessToken, refreshToken };
  }

  async register(dto: RegisterDto): Promise<{message: string}>{
    const existingUser = await this.userService.findByEmail(dto.email)
    if(existingUser){
        throw new ConflictException('Email đã được đăng ký');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const otp = this.generateOtp();
    const otpCodeHash = await bcrypt.hash(otp, SALT_ROUNDS);
    const otpExpiresAt = new Date(Date.now() + this.getOtpExpiryMinutes() * 60_000);

    await this.registrationOtpService.upsert({
      email: dto.email,
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber,
      actorRole: dto.actorRole ?? DEFAULT_ACTOR_ROLE,
      passwordHash,
      otpCodeHash,
      otpExpiresAt,
    });

    await this.mailService.sendOtpMail(dto.email, otp);

    return { message: 'Đã gửi mã OTP xác thực tới email của bạn' };
  }

  async verifyOtp(dto: VerifyOtpDto){
    const pending =  await this.registrationOtpService.findByEmail(dto.email);

    if (!pending) {
      throw new BadRequestException('Không tìm thấy yêu cầu đăng ký cho email này');
    }
    if (pending.otpExpiresAt.getTime() < Date.now()) {
      await this.registrationOtpService.delete(dto.email);
      throw new BadRequestException('Mã OTP đã hết hạn, vui lòng đăng ký lại');
    }

    if (pending.attempts >= MAX_OTP_ATTEMPTS) {
      await this.registrationOtpService.delete(dto.email);
      throw new BadRequestException(
        'Bạn đã nhập sai OTP quá số lần cho phép, vui lòng đăng ký lại',
      );
    }
   
    const isOtpValid = await bcrypt.compare(dto.otp, pending.otpCodeHash);

    if (!isOtpValid) {
      await this.registrationOtpService.incrementAttempts(dto.email);
      throw new UnauthorizedException('Mã OTP không chính xác');
    }

    const defaultRole = await this.userService.findDefaultRole();

    const user = await this.prisma.$transaction(async (tx) => {
      const createUser = await this.userService.createVerifiedUser(
        {
          email: pending.email,
          passwordHash: pending.passwordHash,
          actorRole: pending.actorRole,
          fullName: pending.fullName,
          phoneNumber: pending.phoneNumber,
          defaultRoleId: defaultRole?.roleId,
        },
        tx,
      );

      return createUser
    })

    // Redis không tham gia transaction Postgres nên xóa OTP sau khi user đã tạo thành công
    await this.registrationOtpService.delete(pending.email)

    return {
      message:'Xác thực OTP thành công, tài khoản đã được tạo',
      user: this.userService.toResponseDto(user)
    };
  }

  // ================== LOGIN (bước 1: password) ==================
  async login(dto: LoginDto) {
    const invalidCredentialsMessage = 'Email hoặc mật khẩu không chính xác';
    const user = await this.userService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const remainingMins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new UnauthorizedException(
        `Tài khoản đang tạm khóa do đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${remainingMins} phút`,
      );
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('Tài khoản chưa được kích hoạt hoặc đã bị vô hiệu hóa');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);

    if (!isPasswordValid) {
      const config = await this.securityConfigService.getConfig();
      const updatedUser = await this.userService.registerFailedLogin(
        user.userId,
        config.maxLoginAttempts,
        config.lockoutDurationMins,
      );

      if (updatedUser.lockedUntil) {
        throw new UnauthorizedException(
          `Bạn đã nhập sai mật khẩu quá ${config.maxLoginAttempts} lần. Tài khoản bị khóa trong ${config.lockoutDurationMins} phút`,
        );
      }

      throw new UnauthorizedException(invalidCredentialsMessage);
    }

    // Mật khẩu đúng -> reset đếm sai, tiếp tục qua bước 2 (OTP MFA)
    await this.userService.resetFailedAttempts(user.userId);

    const otp = this.generateOtp();
    const otpCodeHash = await bcrypt.hash(otp, SALT_ROUNDS);
    const otpExpiresAt = new Date(Date.now() + this.getOtpExpiryMinutes() * 60_000);

    await this.loginOtpService.upsert({ userId: user.userId, otpCodeHash, otpExpiresAt });
    await this.mailService.sendLoginOtpMail(user.email, otp);

    return {
      message: 'Mật khẩu chính xác. Đã gửi mã OTP xác thực đăng nhập tới email của bạn',
      email: user.email,
    };
  }

  // ================== LOGIN (bước 2: verify OTP -> issue tokens) ==================
  async verifyLoginOtp(dto: VerifyLoginOtpDto) {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException('Không tìm thấy yêu cầu đăng nhập cho email này');
    }

    const pending = await this.loginOtpService.findByUserId(user.userId);
    if (!pending) {
      throw new BadRequestException('Không tìm thấy yêu cầu đăng nhập, vui lòng đăng nhập lại');
    }

    if (pending.otpExpiresAt.getTime() < Date.now()) {
      await this.loginOtpService.delete(user.userId);
      throw new BadRequestException('Mã OTP đã hết hạn, vui lòng đăng nhập lại');
    }

    if (pending.attempts >= MAX_OTP_ATTEMPTS) {
      await this.loginOtpService.delete(user.userId);
      throw new BadRequestException(
        'Bạn đã nhập sai OTP quá số lần cho phép, vui lòng đăng nhập lại',
      );
    }

    const isOtpValid = await bcrypt.compare(dto.otp, pending.otpCodeHash);
    if (!isOtpValid) {
      await this.loginOtpService.incrementAttempts(user.userId);
      throw new UnauthorizedException('Mã OTP không chính xác');
    }

    await this.loginOtpService.delete(user.userId);
    await this.userService.touchLastLogin(user.userId);

    const tokens = await this.issueTokens(user);

    return {
      message: 'Đăng nhập thành công',
      user: this.userService.toResponseDto(user),
      ...tokens,
    };
  }

  // ================== REFRESH TOKEN ==================
  async refreshToken(dto: RefreshTokenDto) {
    const invalidTokenMessage = 'Refresh token không hợp lệ hoặc đã hết hạn';

    let payload: RefreshTokenPayload;
    try {
      payload = this.jwtService.verify<RefreshTokenPayload>(dto.refreshToken, {
        secret: this.getRefreshTokenSecret(),
      });
    } catch {
      throw new UnauthorizedException(invalidTokenMessage);
    }

    const session = await this.sessionService.findByUserId(payload.sub);
    if (!session || session.revokedAt) {
      throw new UnauthorizedException('Phiên đăng nhập không tồn tại hoặc đã bị thu hồi');
    }

    if (session.expiredAt && session.expiredAt.getTime() < Date.now()) {
      throw new UnauthorizedException(
        'Phiên đăng nhập đã hết hạn (session limit), vui lòng đăng nhập lại',
      );
    }

    const isTokenMatch = await bcrypt.compare(dto.refreshToken, session.refreshTokenHash);
    if (!isTokenMatch) {
      throw new UnauthorizedException(invalidTokenMessage);
    }

    const user = await this.userService.findById(payload.sub);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException('Tài khoản không khả dụng');
    }

    const config = await this.securityConfigService.getConfig();
    const accessToken = this.jwtService.sign(
      { sub: user.userId, email: user.email },
      { expiresIn: `${config.accessTokenTtlMins}m` },
    );
    const newRefreshToken = this.jwtService.sign(
      { sub: user.userId },
      { secret: this.getRefreshTokenSecret(), expiresIn: `${config.refreshTokenTtlHours}h` },
    );

    // Xoay vòng refresh token nhưng KHÔNG dời expiredAt -> session_limit tính tuyệt đối từ lần login gốc
    await this.sessionService.rotateRefreshToken(user.userId, newRefreshToken);

    return { accessToken, refreshToken: newRefreshToken };
  }

  // ================== LOGOUT ==================
  async logout(userId: string) {
    await this.sessionService.revokeByUserId(userId);
    return { message: 'Đăng xuất thành công' };
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

    const otp = this.generateOtp();
    const otpCodeHash = await bcrypt.hash(otp, SALT_ROUNDS);
    const otpExpiresAt = new Date(Date.now() + this.getOtpExpiryMinutes() * 60_000);

    await this.passwordResetOtpService.upsert({ userId: user.userId, otpCodeHash, otpExpiresAt });
    await this.mailService.sendPasswordResetOtpMail(user.email, otp);

    return { message: genericMessage };
  }

  // ================== FORGOT PASSWORD (bước 2: verify OTP -> cấp resetToken) ==================
  async verifyForgotPasswordOtp(dto: VerifyForgotPasswordOtpDto) {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new BadRequestException('Yêu cầu đặt lại mật khẩu không hợp lệ');
    }

    const pending = await this.passwordResetOtpService.findByUserId(user.userId);
    if (!pending) {
      throw new BadRequestException('Không tìm thấy yêu cầu đặt lại mật khẩu, vui lòng thử lại');
    }

    if (pending.otpExpiresAt.getTime() < Date.now()) {
      await this.passwordResetOtpService.delete(user.userId);
      throw new BadRequestException('Mã OTP đã hết hạn, vui lòng yêu cầu lại');
    }

    if (pending.attempts >= MAX_OTP_ATTEMPTS) {
      await this.passwordResetOtpService.delete(user.userId);
      throw new BadRequestException(
        'Bạn đã nhập sai OTP quá số lần cho phép, vui lòng yêu cầu lại',
      );
    }

    const isOtpValid = await bcrypt.compare(dto.otp, pending.otpCodeHash);
    if (!isOtpValid) {
      await this.passwordResetOtpService.incrementAttempts(user.userId);
      throw new UnauthorizedException('Mã OTP không chính xác');
    }

    await this.passwordResetOtpService.markVerified(user.userId);

    const resetTokenTtlMins = Number(this.configService.get('RESET_TOKEN_TTL_MINUTES') ?? 10);
    const resetToken = this.jwtService.sign(
      { sub: user.userId, purpose: RESET_PASSWORD_PURPOSE },
      { secret: this.getResetPasswordSecret(), expiresIn: `${resetTokenTtlMins}m` },
    );

    return { message: 'Xác thực OTP thành công, mời bạn đặt mật khẩu mới', resetToken };
  }

  // ================== FORGOT PASSWORD (bước 3: đặt mật khẩu mới, nhập 2 lần) ==================
  async resetPassword(dto: ResetPasswordDto) {
    if (dto.newPassword !== dto.confirmNewPassword) {
      throw new BadRequestException('Mật khẩu mới và mật khẩu xác nhận không khớp');
    }

    let payload: ResetTokenPayload;
    try {
      payload = this.jwtService.verify<ResetTokenPayload>(dto.resetToken, {
        secret: this.getResetPasswordSecret(),
      });
    } catch {
      throw new UnauthorizedException(
        'Reset token không hợp lệ hoặc đã hết hạn, vui lòng yêu cầu lại OTP',
      );
    }

    if (payload.purpose !== RESET_PASSWORD_PURPOSE) {
      throw new UnauthorizedException('Reset token không hợp lệ');
    }

    // Bắt buộc phải đã verify OTP trước đó mới cho đổi mật khẩu
    const pending = await this.passwordResetOtpService.findByUserId(payload.sub);
    if (!pending || !pending.verified) {
      throw new UnauthorizedException('Bạn cần xác thực OTP trước khi đặt lại mật khẩu');
    }

    const newPasswordHash = await bcrypt.hash(dto.newPassword, SALT_ROUNDS);
    await this.userService.updatePassword(payload.sub, newPasswordHash);
    await this.passwordResetOtpService.delete(payload.sub);

    // Đổi mật khẩu -> revoke tất cả session đang dùng
    await this.sessionService.revokeByUserId(payload.sub);

    return { message: 'Đặt lại mật khẩu thành công. Vui lòng đăng nhập lại' };
  }
}
