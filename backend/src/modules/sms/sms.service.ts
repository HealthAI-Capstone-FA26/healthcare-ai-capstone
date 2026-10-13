import { Injectable, Logger } from '@nestjs/common';

// Mock SMS provider: chưa tích hợp nhà mạng/Twilio/... thật — chỉ log ra console
// để dev/test luồng OTP qua SMS. Khi có provider thật, chỉ cần thay nội dung
// method `send()` (giữ nguyên interface) là các service gọi vào không cần đổi gì.
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  async sendOtpSms(phoneNumber: string, otp: string): Promise<void> {
    await this.send(
      phoneNumber,
      `Ma OTP xac thuc nguoi lien he cua ban la: ${otp}. Vui long khong chia se ma nay.`,
    );
  }

  async sendGuestAppointmentOtpSms(phoneNumber: string, otp: string): Promise<void> {
    await this.send(
      phoneNumber,
      `Ma OTP xac thuc dat lich kham cua ban la: ${otp}. Vui long khong chia se ma nay.`,
    );
  }

  private async send(phoneNumber: string, message: string): Promise<void> {
    // TODO: thay bằng tích hợp SMS provider thật (Twilio/eSMS/Speedsms/...).
    this.logger.log(`[MOCK SMS] -> ${phoneNumber}: ${message}`);
  }
}
