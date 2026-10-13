import { RedisService } from '../../../redis/redis.service';
import { OTP_TTL_BUFFER_SECONDS } from './auth.constants';

// Generic OTP codebase
export interface OtpRecordBase {
  otpCodeHash: string;
  otpExpiresAt: string; // lưu ISO string trong Redis
  attempts: number;
}

export type OtpEntity<T extends OtpRecordBase> = Omit<T, 'otpExpiresAt'> & {
  otpExpiresAt: Date; // parse lại thành Date khi đọc ra khỏi Redis
};

export class OtpStore<T extends OtpRecordBase> {
  constructor(
    protected readonly redis: RedisService,
    private readonly keyPrefix: string,
  ) { }

  protected key(id: string): string {
    return `${this.keyPrefix}${id}`;
  }

  private toEntity(record: T | null): OtpEntity<T> | null {
    if (!record) return null;
    return { ...record, otpExpiresAt: new Date(record.otpExpiresAt) };
  }

  async find(id: string): Promise<OtpEntity<T> | null> {
    const record = await this.redis.getJson<T>(this.key(id));
    return this.toEntity(record);
  }

  // `data` là toàn bộ bản ghi trừ `attempts` (luôn reset về 0 khi upsert mới)
  // và với otpExpiresAt truyền vào dạng Date cho tiện gọi từ service.
  async upsert(id: string, data: Omit<T, 'attempts' | 'otpExpiresAt'> & { otpExpiresAt: Date }): Promise<OtpEntity<T>> {
    const { otpExpiresAt, ...rest } = data;
    const record = {
      ...rest,
      otpExpiresAt: otpExpiresAt.toISOString(),
      attempts: 0,
    } as unknown as T;

    // cộng thêm buffer để tránh Redis tự xóa key trước khi logic check hạn kịp chạy
    const ttlSeconds = Math.ceil((otpExpiresAt.getTime() - Date.now()) / 1000) + OTP_TTL_BUFFER_SECONDS;
    await this.redis.setJson(this.key(id), record, ttlSeconds);

    return this.toEntity(record) as OtpEntity<T>;
  }

  async incrementAttempts(id: string): Promise<OtpEntity<T> | null> {
    const updated = await this.redis.updateJsonKeepTtl<T>(this.key(id), (current) => ({
      ...current,
      attempts: current.attempts + 1,
    }));
    return this.toEntity(updated);
  }

  // Chỉ dùng cho các loại OTP có field `verified` (vd password-reset).
  async markVerified(id: string): Promise<OtpEntity<T> | null> {
    const updated = await this.redis.updateJsonKeepTtl<T>(this.key(id), (current) => ({
      ...current,
      verified: true,
    }));
    return this.toEntity(updated);
  }

  async delete(id: string): Promise<void> {
    await this.redis.del(this.key(id));
  }
}
