import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import { OtpRecordBase, OtpStore } from '../../auth/common/otp-store';

export interface ContactRequestOtpRecord extends OtpRecordBase {
  userId: string;
  patientId: string;
  relationship: string;
}

// OTP dùng để xác thực yêu cầu làm người liên hệ (Contact Request). Key CHỈ theo
// userId (không có patientId — client không truyền patientId, xem patient-contact.service.ts)
// nên 1 user chỉ có tối đa 1 yêu cầu đang chờ OTP tại 1 thời điểm (gửi request mới sẽ
// ghi đè request cũ). patientId thật vẫn được lưu trong nội dung record để dùng khi verify.
@Injectable()
export class ContactRequestOtpStore extends OtpStore<ContactRequestOtpRecord> {
  constructor(redis: RedisService) {
    super(redis, 'contact_request_otp:');
  }

  static id(userId: string): string {
    return userId;
  }
}