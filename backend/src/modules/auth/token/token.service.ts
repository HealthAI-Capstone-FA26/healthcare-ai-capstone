import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

export interface RefreshTokenPayload {
  sub: string;
}

export interface ResetTokenPayload {
  sub: string;
  purpose: string;
}

/**
 * Tập trung toàn bộ việc ký/verify JWT (access token, refresh token,
 * reset-password token) vào 1 chỗ.
 *
 * Trước đây đoạn ký access token + refresh token bị lặp lại y hệt ở cả
 * `issueTokens()` (login) và `refreshToken()` (cấp lại token) trong
 * AuthService cũ — sửa TTL hay claim ở 1 chỗ dễ quên sửa chỗ kia.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  private getRefreshTokenSecret(): string {
    return this.configService.getOrThrow<string>('REFRESH_TOKEN_SECRET');
  }

  private getResetPasswordSecret(): string {
    return this.configService.getOrThrow<string>('RESET_PASSWORD_SECRET');
  }

  // Access token: ký bằng JWT_SECRET mặc định (đã cấu hình sẵn trong JwtModule ở auth.module.ts)
  signAccessToken(user: { userId: string; email: string }, ttlMins: number): string {
    return this.jwtService.sign(
      { sub: user.userId, email: user.email },
      { expiresIn: `${ttlMins}m` },
    );
  }

  // Refresh token: dùng secret RIÊNG (REFRESH_TOKEN_SECRET), tách biệt với access token
  signRefreshToken(userId: string, ttlHours: number): string {
    return this.jwtService.sign(
      { sub: userId },
      { secret: this.getRefreshTokenSecret(), expiresIn: `${ttlHours}h` },
    );
  }

  verifyRefreshToken(token: string): RefreshTokenPayload {
    return this.jwtService.verify<RefreshTokenPayload>(token, {
      secret: this.getRefreshTokenSecret(),
    });
  }

  // Reset-password token: dùng secret RIÊNG (RESET_PASSWORD_SECRET) + purpose
  // để không thể tái sử dụng nhầm sang mục đích khác
  signResetToken(userId: string, purpose: string, ttlMins: number): string {
    return this.jwtService.sign(
      { sub: userId, purpose },
      { secret: this.getResetPasswordSecret(), expiresIn: `${ttlMins}m` },
    );
  }

  verifyResetToken(token: string): ResetTokenPayload {
    return this.jwtService.verify<ResetTokenPayload>(token, {
      secret: this.getResetPasswordSecret(),
    });
  }
}
