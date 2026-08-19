import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

interface UpsertLoginOtpInput {
  userId: string;
  otpCodeHash: string;
  otpExpiresAt: Date;
}

interface LoginOtpRecord {
  userId: string;
  otpCodeHash: string;
  otpExpiresAt: string; // ISO string
  attempts: number;
}

interface LoginOtpEntity extends Omit<LoginOtpRecord, 'otpExpiresAt'> {
  otpExpiresAt: Date;
}

const KEY_PREFIX = 'login_otp:';
const TTL_BUFFER_SECONDS = 60;

// OTP dùng cho bước 2 của đăng nhập (MFA), tách riêng với RegistrationOtp — lưu trong Redis
@Injectable()
export class LoginOtpService {
  constructor(private readonly redis: RedisService) {}

  private key(userId: string) {
    return `${KEY_PREFIX}${userId}`;
  }

  private toEntity(record: LoginOtpRecord | null): LoginOtpEntity | null {
    if (!record) return null;
    return { ...record, otpExpiresAt: new Date(record.otpExpiresAt) };
  }

  async findByUserId(userId: string): Promise<LoginOtpEntity | null> {
    const record = await this.redis.getJson<LoginOtpRecord>(this.key(userId));
    return this.toEntity(record);
  }

  async upsert(input: UpsertLoginOtpInput): Promise<LoginOtpEntity> {
    const { userId, otpExpiresAt, ...data } = input;
    const record: LoginOtpRecord = {
      userId,
      ...data,
      otpExpiresAt: otpExpiresAt.toISOString(),
      attempts: 0,
    };

    const ttlSeconds = Math.ceil((otpExpiresAt.getTime() - Date.now()) / 1000) + TTL_BUFFER_SECONDS;
    await this.redis.setJson(this.key(userId), record, ttlSeconds);

    return this.toEntity(record) as LoginOtpEntity;
  }

  async incrementAttempts(userId: string): Promise<LoginOtpEntity | null> {
    const updated = await this.redis.updateJsonKeepTtl<LoginOtpRecord>(
      this.key(userId),
      (current) => ({ ...current, attempts: current.attempts + 1 }),
    );
    return this.toEntity(updated);
  }

  async delete(userId: string): Promise<void> {
    await this.redis.del(this.key(userId));
  }
}
