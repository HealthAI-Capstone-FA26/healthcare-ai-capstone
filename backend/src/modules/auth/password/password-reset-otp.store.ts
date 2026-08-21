import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import { OtpRecordBase, OtpStore } from '../common/otp-store';

export interface PasswordResetOtpRecord extends OtpRecordBase {
  userId: string;
  verified: boolean;
}

// OTP dùng cho flow quên mật khẩu (forgot password)
@Injectable()
export class PasswordResetOtpStore extends OtpStore<PasswordResetOtpRecord> {
  constructor(redis: RedisService) {
    super(redis, 'password_reset_otp:');
  }
}
