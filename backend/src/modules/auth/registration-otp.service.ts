import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

interface UpsertOtpInput {
  email: string;
  fullName: string;
  phoneNumber?: string | null;
  actorRole: string;
  passwordHash: string;
  otpCodeHash: string;
  otpExpiresAt: Date;
}

interface RegistrationOtpRecord {
  email: string;
  fullName: string;
  phoneNumber?: string | null;
  actorRole: string;
  passwordHash: string;
  otpCodeHash: string;
  otpExpiresAt: string; // lưu ISO string trong Redis
  attempts: number;
}

interface RegistrationOtpEntity extends Omit<RegistrationOtpRecord, 'otpExpiresAt'> {//Lấy tất cả thuộc tính từ RegistrationOtpRecord
  otpExpiresAt: Date; // Nhưng loại bỏ otpExpiresAt (vì nó là string), Sau đó thêm lại otpExpiresAt với kiểu Date, tránh lập lại code
}

const KEY_PREFIX = 'registration_otp:';
// Redis tự dọn key khi hết hạn, cộng thêm buffer nhỏ để logic check hạn trong
// AuthService luôn chạy trước khi key tự biến mất.
const TTL_BUFFER_SECONDS = 60;

@Injectable()
export class RegistrationOtpService {
  constructor(private readonly redis: RedisService) {}

  private key(email: string) {
    return `${KEY_PREFIX}${email}`;
  }

  private toEntity(record: RegistrationOtpRecord | null): RegistrationOtpEntity | null {
    if (!record) return null;
    return { ...record, otpExpiresAt: new Date(record.otpExpiresAt) };
  }

  async findByEmail(email: string): Promise<RegistrationOtpEntity | null> {
    const record = await this.redis.getJson<RegistrationOtpRecord>(this.key(email));
    return this.toEntity(record);
  }

  async upsert(input: UpsertOtpInput): Promise<RegistrationOtpEntity> {
    const { email, otpExpiresAt, ...data } = input;
    const record: RegistrationOtpRecord = {
      email,
      ...data,
      otpExpiresAt: otpExpiresAt.toISOString(),
      attempts: 0,
    };

    const ttlSeconds = Math.ceil((otpExpiresAt.getTime() - Date.now()) / 1000) + TTL_BUFFER_SECONDS; // cộng thêm buffer để để đến tgian đúng k bị hiện sai
    await this.redis.setJson(this.key(email), record, ttlSeconds);

    return this.toEntity(record) as RegistrationOtpEntity;
  }

  async incrementAttempts(email: string): Promise<RegistrationOtpEntity | null> {
    const updated = await this.redis.updateJsonKeepTtl<RegistrationOtpRecord>(
      this.key(email),
      (current) => ({ ...current, attempts: current.attempts + 1 }),
    );
    return this.toEntity(updated);
  }

  async delete(email: string): Promise<void> {
    await this.redis.del(this.key(email));
  }
}
