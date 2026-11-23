import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

// Brevo Transactional Email API (HTTPS) — thay cho SMTP/nodemailer
const BREVO_SEND_URL = 'https://api.brevo.com/v3/smtp/email';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly apiKey: string;
  private readonly sender: { email: string; name?: string };

  constructor(private readonly configService: ConfigService) {
    // API key lấy ở Brevo: SMTP & API > API Keys
    this.apiKey = this.configService.getOrThrow<string>('BREVO_API_KEY');
    // Sender phải là email/domain đã được verify trong Brevo
    this.sender = {
      email: this.configService.getOrThrow<string>('MAIL_FROM_EMAIL'),
      name: this.configService.get<string>('MAIL_FROM_NAME') || undefined,
    };
  }

  /** Gửi mail qua Brevo API — dùng chung cho mọi loại mail bên dưới. */
  private async send(to: string, subject: string, html: string, text?: string): Promise<void> {
    try {
      await axios.post(
        BREVO_SEND_URL,
        {
          sender: this.sender,
          to: [{ email: to }],
          subject,
          htmlContent: html,
          ...(text ? { textContent: text } : {}),
        },
        {
          headers: { 'api-key': this.apiKey, 'content-type': 'application/json', accept: 'application/json' },
          timeout: 15000,
        },
      );
    } catch (err) {
      // Log chi tiết lỗi từ Brevo (vd: sender chưa verify, key sai) rồi ném lại để caller xử lý như trước
      const detail = axios.isAxiosError(err) ? JSON.stringify(err.response?.data ?? err.message) : String(err);
      this.logger.error(`Gửi mail qua Brevo tới ${to} thất bại: ${detail}`);
      throw err;
    }
  }

  async sendOtpMail(to: string, otp: string): Promise<void> {
    const expiresMinutes = this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? '5';

    await this.send(
      to,
      'Mã xác thực đăng ký tài khoản',
      `
        <p>Xin chào,</p>
        <p>Mã OTP xác thực đăng ký tài khoản của bạn là:</p>
        <h2 style="letter-spacing: 4px;">${otp}</h2>
        <p>Mã có hiệu lực trong ${expiresMinutes} phút. Vui lòng không chia sẻ mã này cho bất kỳ ai.</p>
      `,
    );

    this.logger.log(`Đã gửi OTP đăng ký tới ${to}`);
  }

  async sendLoginOtpMail(to: string, otp: string): Promise<void> {
    const expiresMinutes = this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? '5';

    await this.send(
      to,
      'Mã xác thực đăng nhập (MFA)',
      `
        <p>Xin chào,</p>
        <p>Mã OTP xác thực đăng nhập của bạn là:</p>
        <h2 style="letter-spacing: 4px;">${otp}</h2>
        <p>Mã có hiệu lực trong ${expiresMinutes} phút. Nếu không phải bạn đăng nhập, vui lòng đổi mật khẩu ngay.</p>
      `,
    );

    this.logger.log(`Đã gửi OTP đăng nhập tới ${to}`);
  }

  async sendGuestAppointmentOtpMail(to: string, otp: string): Promise<void> {
    const expiresMinutes = this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? '5';

    await this.send(
      to,
      'Mã xác thực đặt lịch khám',
      `
        <p>Xin chào,</p>
        <p>Mã OTP xác thực đặt lịch khám của bạn là:</p>
        <h2 style="letter-spacing: 4px;">${otp}</h2>
        <p>Mã có hiệu lực trong ${expiresMinutes} phút. Vui lòng không chia sẻ mã này cho bất kỳ ai.</p>
      `,
    );

    this.logger.log(`Đã gửi OTP đặt lịch guest tới ${to}`);
  }

  async sendPasswordResetOtpMail(to: string, otp: string): Promise<void> {
    const expiresMinutes = this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? '5';

    await this.send(
      to,
      'Mã xác thực đặt lại mật khẩu',
      `
        <p>Xin chào,</p>
        <p>Mã OTP đặt lại mật khẩu của bạn là:</p>
        <h2 style="letter-spacing: 4px;">${otp}</h2>
        <p>Mã có hiệu lực trong ${expiresMinutes} phút. Nếu không phải bạn yêu cầu, vui lòng bỏ qua email này.</p>
      `,
    );

    this.logger.log(`Đã gửi OTP đặt lại mật khẩu tới ${to}`);
  }

  /** Email thông báo nghiệp vụ (worker thông báo SE07 gọi): nội dung text thuần, được escape HTML. */
  async sendPlainMail(to: string, subject: string, text: string): Promise<void> {
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');

    await this.send(to, subject, `<p>${escaped}</p>`, text);
    this.logger.log(`Đã gửi email thông báo tới ${to}`);
  }
}