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

  /**
   * Gửi email hướng dẫn bệnh nhân chưa có tài khoản tự đăng ký và liên kết hồ sơ cũ.
   * Không chứa thông tin cá nhân hay y tế nhạy cảm của bệnh nhân để đảm bảo bảo mật.
   */
  async sendPatientPortalGuideMail(to: string): Promise<void> {
    const baseUrl = (this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:5173').replace(/\/$/, '');
    const registerUrl = `${baseUrl}/register`;
    const loginUrl = `${baseUrl}/login`;

    await this.send(
      to,
      'Hướng dẫn đăng ký tài khoản & liên kết hồ sơ bệnh nhân',
      `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px;">
          <p>Xin chào Quý khách,</p>
          <p>Cảm ơn Quý khách đã đến thăm khám tại phòng khám. Để thuận tiện cho việc đặt lịch khám trực tuyến và theo dõi lịch sử khám bệnh, đơn thuốc về sau, Quý khách vui lòng thực hiện theo 2 bước dưới đây:</p>

          <h3 style="color: #0b3c8f; margin-bottom: 6px;">Bước 1: Đăng ký tài khoản bệnh nhân</h3>
          <p style="margin-top: 0;">
            Truy cập đường dẫn đăng ký:<br/>
            <a href="${registerUrl}" style="display: inline-block; margin: 8px 0; padding: 10px 18px; background: #0b3c8f; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: bold;">
              Đăng ký tài khoản ngay
            </a><br/>
            <span style="font-size: 13px; color: #475569;">Hoặc mở trình duyệt và truy cập: ${registerUrl}</span>
          </p>
          <p>Điền Họ tên, Email, Số điện thoại, Mật khẩu và nhập mã OTP được gửi về email để kích hoạt tài khoản.</p>

          <h3 style="color: #0b3c8f; margin-bottom: 6px;">Bước 2: Liên kết với hồ sơ bệnh nhân đã có</h3>
          <ol style="padding-left: 20px; margin-top: 0;">
            <li>Đăng nhập vào hệ thống tại: <a href="${loginUrl}">${loginUrl}</a></li>
            <li>Vào mục <strong>Hồ sơ bệnh nhân</strong> và chọn <strong>Tra cứu &amp; Liên kết hồ sơ</strong>.</li>
            <li>Nhập <strong>Số CCCD / Số BHYT / Số điện thoại</strong> đã sử dụng khi đăng ký khám tại quầy để liên kết hồ sơ vào tài khoản của Quý khách.</li>
          </ol>

          <p style="font-size: 13px; color: #64748b; border-top: 1px solid #e2e8f0; padding-top: 12px; margin-top: 20px;">
            Lưu ý: Vì lý do bảo mật thông tin y tế, email này không đính kèm thông tin hồ sơ cá nhân của Quý khách. Nếu Quý khách đã có tài khoản trước đó, vui lòng bỏ qua email này.
          </p>
        </div>
      `,
    );

    this.logger.log(`Đã gửi email hướng dẫn đăng ký & liên kết hồ sơ tới ${to}`);
  }
}