import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../../prisma/prisma.service';
import { UpdateSecurityConfigDto } from '../dto/update-security-config.dto';

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
  ) { }

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

  // Admin cập nhật (partial) các thông số bảo mật.
  // - Nếu đã có row cấu hình -> update tiếp trên row mới nhất (không đẻ thêm row).
  // - Nếu chưa có row nào -> tạo mới, các field không truyền lấy từ giá trị mặc định (.env).
  async updateConfig(userId: string, dto: UpdateSecurityConfigDto): Promise<SecurityConfig> {
    const existing = await this.prisma.securitySetting.findFirst({
      orderBy: { updatedAt: 'desc' },
    });

    if (existing) {
      const updated = await this.prisma.securitySetting.update({
        where: { settingId: existing.settingId },
        data: {
          accessTokenTtlMins: dto.accessTokenTtlMins ?? existing.accessTokenTtlMins,
          refreshTokenTtlHours: dto.refreshTokenTtlHours ?? existing.refreshTokenTtlHours,
          maxSessionHours: dto.maxSessionHours ?? existing.maxSessionHours,
          maxLoginAttempts: dto.maxLoginAttempts ?? existing.maxLoginAttempts,
          lockoutDurationMins: dto.lockoutDurationMins ?? existing.lockoutDurationMins,
          mfaRequired: dto.mfaRequired ?? existing.mfaRequired,
        },
      });

      return {
        accessTokenTtlMins: updated.accessTokenTtlMins,
        refreshTokenTtlHours: updated.refreshTokenTtlHours,
        maxSessionHours: updated.maxSessionHours,
        maxLoginAttempts: updated.maxLoginAttempts,
        lockoutDurationMins: updated.lockoutDurationMins,
        mfaRequired: updated.mfaRequired,
      };
    }

    // Chưa có row nào -> lấy giá trị mặc định làm nền, ghi đè bằng field admin vừa gửi lên
    const defaults = await this.getConfig();
    const created = await this.prisma.securitySetting.create({
      data: {
        accessTokenTtlMins: dto.accessTokenTtlMins ?? defaults.accessTokenTtlMins,
        refreshTokenTtlHours: dto.refreshTokenTtlHours ?? defaults.refreshTokenTtlHours,
        maxSessionHours: dto.maxSessionHours ?? defaults.maxSessionHours,
        maxLoginAttempts: dto.maxLoginAttempts ?? defaults.maxLoginAttempts,
        lockoutDurationMins: dto.lockoutDurationMins ?? defaults.lockoutDurationMins,
        mfaRequired: dto.mfaRequired ?? defaults.mfaRequired,
        idleTimeoutMins: Number(this.configService.get('IDLE_TIMEOUT_MINUTES') ?? 30),
        updatedByUser: {
          connect: { userId: userId }, // Đảm bảo truyền userId của Admin đang gọi API này
        }
      },
    });

    return {
      accessTokenTtlMins: created.accessTokenTtlMins,
      refreshTokenTtlHours: created.refreshTokenTtlHours,
      maxSessionHours: created.maxSessionHours,
      maxLoginAttempts: created.maxLoginAttempts,
      lockoutDurationMins: created.lockoutDurationMins,
      mfaRequired: created.mfaRequired,
    };
  }
}
