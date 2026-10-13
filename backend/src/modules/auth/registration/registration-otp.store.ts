import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import { OtpRecordBase, OtpStore } from '../common/otp-store';

export interface RegistrationOtpRecord extends OtpRecordBase {
  email: string;
  fullName: string;
  phoneNumber?: string | null;
  avatarUrl?: string | null;
  actorRole: string;
  passwordHash: string;
}

// OTP dùng cho bước xác thực tạo tài khoản mới. Chỉ còn khai báo prefix
// + shape dữ liệu riêng; toàn bộ logic Redis nằm trong OtpStore dùng chung.
@Injectable()
export class RegistrationOtpStore extends OtpStore<RegistrationOtpRecord> {
  constructor(redis: RedisService) {
    super(redis, 'registration_otp:');
  }
}
