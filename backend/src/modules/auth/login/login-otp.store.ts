import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import { OtpRecordBase, OtpStore } from '../common/otp-store';

export interface LoginOtpRecord extends OtpRecordBase {
  userId: string;
}

// OTP dùng cho bước 2 của đăng nhập (MFA), tách riêng key prefix với RegistrationOtp
@Injectable()
export class LoginOtpStore extends OtpStore<LoginOtpRecord> {
  constructor(redis: RedisService) {
    super(redis, 'login_otp:');
  }
}
