import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

interface UpsertResetOtpInput {
  userId: string;
  otpCodeHash: string;
  otpExpiresAt: Date;
}

interface PasswordResetOtpRecord {
  userId: string;
  otpCodeHash: string;
  otpExpiresAt: string; // ISO string
  attempts: number;
  verified: boolean;
}

interface PasswordResetOtpEntity extends Omit<PasswordResetOtpRecord, 'otpExpiresAt'> {
  otpExpiresAt: Date;
}

const KEY_PREFIX = 'password_reset_otp:';
const TTL_BUFFER_SECONDS = 60;

// OTP dùng cho flow quên mật khẩu (forgot password) — lưu trong Redis
@Injectable()
export class PasswordResetOtpService {
  constructor(private readonly redis: RedisService) {}

  private key(userId: string) {
    return `${KEY_PREFIX}${userId}`;
  }

  private toEntity(record: PasswordResetOtpRecord | null): PasswordResetOtpEntity | null {
    if (!record) return null;
    return { ...record, otpExpiresAt: new Date(record.otpExpiresAt) };
  }

  async findByUserId(userId: string): Promise<PasswordResetOtpEntity | null> {
    const record = await this.redis.getJson<PasswordResetOtpRecord>(this.key(userId));
    return this.toEntity(record);
  }

  async upsert(input: UpsertResetOtpInput): Promise<PasswordResetOtpEntity> {
    const { userId, otpExpiresAt, ...data } = input;
    const record: PasswordResetOtpRecord = {
      userId,
      ...data,
      otpExpiresAt: otpExpiresAt.toISOString(),
      attempts: 0,
      verified: false,
    };

    const ttlSeconds = Math.ceil((otpExpiresAt.getTime() - Date.now()) / 1000) + TTL_BUFFER_SECONDS;
    await this.redis.setJson(this.key(userId), record, ttlSeconds);

    return this.toEntity(record) as PasswordResetOtpEntity;
  }

  async incrementAttempts(userId: string): Promise<PasswordResetOtpEntity | null> {
    const updated = await this.redis.updateJsonKeepTtl<PasswordResetOtpRecord>(
      this.key(userId),
      (current) => ({ ...current, attempts: current.attempts + 1 }),
    );
    return this.toEntity(updated);
  }

  async markVerified(userId: string): Promise<PasswordResetOtpEntity | null> {
    const updated = await this.redis.updateJsonKeepTtl<PasswordResetOtpRecord>(
      this.key(userId),
      (current) => ({ ...current, verified: true }),
    );
    return this.toEntity(updated);
  }

  async delete(userId: string): Promise<void> {
    await this.redis.del(this.key(userId));
  }
}
