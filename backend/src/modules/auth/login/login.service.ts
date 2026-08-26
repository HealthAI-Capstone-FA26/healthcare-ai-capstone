import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { UserService } from '../../user/user.service';
import { SessionService } from '../session/session.service';
import { SecurityConfigService } from '../security-config/security-config.service';
import { TokenService } from '../token/token.service';
import { LoginDto } from '../dto/login.dto';
import { RefreshTokenDto } from '../dto/refresh-token.dto';

// ================== LOGIN, REFRESH, LOGOUT ==================
@Injectable()
export class LoginService {
  constructor(
    private readonly userService: UserService,
    private readonly sessionService: SessionService,
    private readonly securityConfigService: SecurityConfigService,
    private readonly tokenService: TokenService,
  ) { }

  // Sinh cặp access token (ngắn hạn) + refresh token (dài hạn hơn), đồng thời tạo/replace session trong DB
  private async issueTokens(user: { userId: string; email: string }) {
    const config = await this.securityConfigService.getConfig();

    const accessToken = this.tokenService.signAccessToken(user, config.accessTokenTtlMins);
    const refreshToken = this.tokenService.signRefreshToken(user.userId, config.refreshTokenTtlHours);

    // expiredAt của session = session_limit tuyệt đối tính từ thời điểm đăng nhập này
    await this.sessionService.createSession(user.userId, refreshToken, config.maxSessionHours);

    return { accessToken, refreshToken };
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

    // Mật khẩu đúng -> reset đếm sai và cấp token ngay
    await this.userService.resetFailedAttempts(user.userId);
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

    let payload: { sub: string };
    try {
      payload = this.tokenService.verifyRefreshToken(dto.refreshToken);
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
    const accessToken = this.tokenService.signAccessToken(user, config.accessTokenTtlMins);
    const newRefreshToken = this.tokenService.signRefreshToken(user.userId, config.refreshTokenTtlHours);

    // Xoay vòng refresh token nhưng KHÔNG dời expiredAt -> session_limit tính tuyệt đối từ lần login gốc
    await this.sessionService.rotateRefreshToken(user.userId, newRefreshToken);

    return { accessToken, refreshToken: newRefreshToken };
  }

  // ================== LOGOUT ==================
  async logout(userId: string) {
    await this.sessionService.revokeByUserId(userId);
    return { message: 'Đăng xuất thành công' };
  }
}
