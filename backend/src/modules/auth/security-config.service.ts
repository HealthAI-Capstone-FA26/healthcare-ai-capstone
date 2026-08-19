import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';

export interface SecurityConfig {
  accessTokenTtlMins: number;
  refreshTokenTtlHours: number;
  maxSessionHours: number;
  maxLoginAttempts: number;
  lockoutDurationMins: number;
  mfaRequired: boolean;
}

// Đọc cấu hình bảo mật từ bảng security_settings (admin có thể chỉnh),
// nếu chưa có row nào thì fallback về giá trị mặc định trong .env
@Injectable()
export class SecurityConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getConfig(): Promise<SecurityConfig> {
    const setting = await this.prisma.securitySetting.findFirst({
      orderBy: { updatedAt: 'desc' },
    });

    if (setting) {
      return {
        accessTokenTtlMins: setting.accessTokenTtlMins,
        refreshTokenTtlHours: setting.refreshTokenTtlHours,
        maxSessionHours: setting.maxSessionHours,
        maxLoginAttempts: setting.maxLoginAttempts,
        lockoutDurationMins: setting.lockoutDurationMins,
        mfaRequired: setting.mfaRequired,
      };
    }

    return {
      accessTokenTtlMins: Number(this.configService.get('ACCESS_TOKEN_TTL_MINUTES') ?? 15),
      refreshTokenTtlHours: Number(this.configService.get('REFRESH_TOKEN_TTL_HOURS') ?? 8),
      maxSessionHours: Number(this.configService.get('MAX_SESSION_HOURS') ?? 8),
      maxLoginAttempts: Number(this.configService.get('MAX_LOGIN_ATTEMPTS') ?? 5),
      lockoutDurationMins: Number(this.configService.get('LOCKOUT_DURATION_MINUTES') ?? 15),
      mfaRequired: true,
    };
  }
}
