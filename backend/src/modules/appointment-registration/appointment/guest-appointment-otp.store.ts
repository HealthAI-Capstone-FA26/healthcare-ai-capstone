import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import { OtpRecordBase, OtpStore } from '../../auth/common/otp-store';
import { GuestRequestOtpDto } from './dto/guest-request-otp.dto';

// Bước 1 (request-otp) CHỈ nhận phoneNumber — chưa biết thông tin đặt lịch (fullName/dob/
// identityNumber/departmentId/slotId...) nên record OTP không cần giữ các field đó. Toàn bộ
// thông tin đặt lịch được guest gửi lại 1 lần nữa ở bước 2 (verify-otp), dùng ngay lúc đó để
// match/tạo patient — xem GuestAppointmentService.
export interface GuestAppointmentOtpRecord extends OtpRecordBase {
  phoneNumber: string;
  email?: string;
  appointmentData: GuestRequestOtpDto;
}

// Key theo phoneNumber (không có userId vì guest chưa đăng nhập) — 1 SĐT chỉ có tối đa 1 yêu cầu
// OTP đang chờ tại 1 thời điểm, gửi request mới sẽ ghi đè request cũ (giống ContactRequestOtpStore
// keyed theo userId).
@Injectable()
export class GuestAppointmentOtpStore extends OtpStore<GuestAppointmentOtpRecord> {
  constructor(redis: RedisService) {
    super(redis, 'guest_appointment_otp:');
  }

  static id(phoneNumber: string): string {
    return phoneNumber;
  }
}
