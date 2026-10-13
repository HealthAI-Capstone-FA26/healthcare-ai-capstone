import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../../prisma/prisma.service';
import { SALT_ROUNDS } from '../common/auth.constants';

// Quản lý user_sessions: 1 user hiện chỉ có 1 session đang hoạt động (theo unique userId của schema).
// expiredAt là mốc "session_limit" tuyệt đối tính từ lúc login, không bị dời khi refresh token.
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(userId: string, refreshToken: string, maxSessionHours: number) {
    const refreshTokenHash = await bcrypt.hash(refreshToken, SALT_ROUNDS);
    const now = new Date();
    const expiredAt = new Date(now.getTime() + maxSessionHours * 60 * 60_000);

    // upsert vì mỗi user chỉ có 1 session (userId unique) -> login mới sẽ thay session cũ
    return this.prisma.userSession.upsert({
      where: { userId },
      create: { userId, refreshTokenHash, expiredAt },
      update: { refreshTokenHash, createdAt: now, expiredAt, revokedAt: null },
    });
  }

  findByUserId(userId: string) {
    return this.prisma.userSession.findUnique({ where: { userId } });
  }

  // Xoay vòng refresh token nhưng GIỮ NGUYÊN expiredAt (không nới hạn mức session_limit)
  async rotateRefreshToken(userId: string, newRefreshToken: string) {
    const refreshTokenHash = await bcrypt.hash(newRefreshToken, SALT_ROUNDS);
    return this.prisma.userSession.update({
      where: { userId },
      data: { refreshTokenHash },
    });
  }

  // Thu hồi session (dùng khi logout hoặc đổi mật khẩu -> revoke tất cả session đang dùng)
  revokeByUserId(userId: string) {
    return this.prisma.userSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
