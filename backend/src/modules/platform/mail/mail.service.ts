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
    const baseUrl = (this.configService.get<string>('FRONTEND_URL') ?? 'https://www.4am.website').replace(/\/$/, '');
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

  /**
   * Gửi email xác nhận đặt lịch khám trực tuyến thành công (dùng chung cho cả Guest và Bệnh nhân có tài khoản).
   * Giao diện bảng thông báo đồng bộ với modal "Đăng ký khám thành công" trên web.
   */
  async sendOnlineBookingSuccessMail(params: {
    to: string;
    appointmentCode: string;
    patientName: string;
    patientSubLabel?: string; // SĐT (với Guest) hoặc Mã BN (với Patient có tài khoản)
    doctorName: string;
    slotStartTime: Date;
    slotEndTime: Date;
    reasonForVisit?: string | null;
    isGuest?: boolean;
  }): Promise<void> {
    const esc = (s: string) =>
      s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

    const startTimeStr = params.slotStartTime.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    const endTimeStr = params.slotEndTime.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'UTC',
    });
    const dateStr = params.slotStartTime.toLocaleDateString('vi-VN', {
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    });

    const customerDisplay = params.patientSubLabel
      ? `${esc(params.patientName)} (${esc(params.patientSubLabel)})`
      : esc(params.patientName);

    const reasonRow = params.reasonForVisit?.trim()
      ? `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.14); color: #bfdbfe; font-size: 13px;">Lý do khám:</td>
          <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.14); color: #ffffff; font-weight: 700; font-size: 13px; text-align: right;">${esc(params.reasonForVisit.trim())}</td>
        </tr>
      `
      : '';

    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; background-color: #f1f5f9; padding: 24px 12px;">
        <div style="max-width: 560px; margin: 0 auto; background: linear-gradient(180deg, #2563eb 0%, #1d4ed8 55%, #0b3c8f 100%); background-color: #0b3c8f; border-radius: 24px; overflow: hidden; box-shadow: 0 10px 25px rgba(11, 60, 143, 0.25); color: #ffffff;">
          
          <!-- Header -->
          <div style="background-color: #0b3c8f; padding: 16px 24px; text-align: center; border-bottom: 1px solid rgba(255,255,255,0.15);">
            <div style="font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #dbeafe;">
              Phòng Khám Chuyên Khoa Tim Mạch 4AM · Đăng Ký Khám Trực Tuyến
            </div>
          </div>

          <!-- Body -->
          <div style="padding: 28px 24px; text-align: center;">
            <div style="width: 56px; height: 56px; line-height: 56px; border-radius: 999px; background-color: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25); margin: 0 auto 16px auto; font-size: 28px; color: #facc15; font-weight: bold;">
              ✓
            </div>

            <h2 style="margin: 0 0 6px 0; font-size: 20px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #ffffff;">
              Đăng ký khám thành công
            </h2>
            <p style="margin: 0; font-size: 13px; color: #dbeafe;">
              Mã số lịch hẹn của bạn là:
            </p>
            <div style="margin: 8px 0 20px 0; font-family: 'Courier New', Courier, monospace; font-size: 24px; font-weight: 800; color: #facc15; letter-spacing: 2px;">
              ${esc(params.appointmentCode)}
            </div>

            <!-- Info Table Card -->
            <div style="background-color: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.18); border-radius: 16px; padding: 16px 20px; text-align: left; margin-bottom: 18px;">
              <table style="width: 100%; border-collapse: collapse;">
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.14); color: #bfdbfe; font-size: 13px;">
                    ${params.isGuest ? 'Khách hàng:' : 'Bệnh nhân:'}
                  </td>
                  <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.14); color: #ffffff; font-weight: 700; font-size: 13px; text-align: right;">
                    ${customerDisplay}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.14); color: #bfdbfe; font-size: 13px;">
                    Bác sĩ khám:
                  </td>
                  <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.14); color: #ffffff; font-weight: 700; font-size: 13px; text-align: right;">
                    ${esc(params.doctorName)}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.14); color: #bfdbfe; font-size: 13px;">
                    Ngày khám:
                  </td>
                  <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.14); color: #ffffff; font-weight: 700; font-size: 13px; text-align: right;">
                    ${esc(dateStr)}
                  </td>
                </tr>
                <tr>
                  <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.14); color: #bfdbfe; font-size: 13px;">
                    Khung giờ hẹn:
                  </td>
                  <td style="padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.14); color: #fde047; font-weight: 700; font-size: 13px; text-align: right;">
                    ${esc(startTimeStr)} - ${esc(endTimeStr)}
                  </td>
                </tr>
                ${reasonRow}
                <tr>
                  <td style="padding: 10px 0 2px 0; color: #bfdbfe; font-size: 13px;">
                    Email nhận thông báo:
                  </td>
                  <td style="padding: 10px 0 2px 0; color: #ffffff; font-weight: 700; font-size: 13px; text-align: right;">
                    ${esc(params.to)}
                  </td>
                </tr>
              </table>
            </div>

            <!-- Next Steps Box -->
            <div style="background-color: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.12); border-radius: 16px; padding: 16px 20px; text-align: left;">
              <div style="font-size: 12px; font-weight: 700; color: #fcd34d; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 10px;">
                📋 Các bước tiếp theo:
              </div>
              <div style="font-size: 12.5px; color: #dbeafe; line-height: 1.6;">
                <div style="margin-bottom: 8px;">
                  <strong style="color: #ffffff;">1. Chờ tiếp đón xác nhận:</strong> Nhân viên lễ tân sẽ kiểm tra và xác nhận lịch hẹn của bạn.
                </div>
                <div style="margin-bottom: 8px;">
                  <strong style="color: #ffffff;">2. Đến quầy Lễ tân trước 15 phút:</strong> Đọc mã lịch hẹn <strong style="color: #facc15;">${esc(params.appointmentCode)}</strong>, xuất trình CCCD/BHYT để check-in và đo sinh hiệu ban đầu.
                </div>
                <div>
                  <strong style="color: #ffffff;">3. Nhận số thứ tự A:</strong> Nhận phiếu khám ưu tiên để vào phòng khám chuyên khoa Tim mạch.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const text =
      `ĐĂNG KÝ KHÁM THÀNH CÔNG\n` +
      `Mã số lịch hẹn: ${params.appointmentCode}\n` +
      `Bệnh nhân: ${params.patientName}${params.patientSubLabel ? ` (${params.patientSubLabel})` : ''}\n` +
      `Bác sĩ khám: ${params.doctorName}\n` +
      `Thời gian hẹn: ${startTimeStr} - ${endTimeStr}, ${dateStr}\n` +
      `Các bước tiếp theo:\n` +
      `1. Chờ tiếp đón xác nhận lịch hẹn.\n` +
      `2. Đến quầy Lễ tân trước 15 phút, đọc mã ${params.appointmentCode} và đối chiếu CCCD.\n` +
      `3. Nhận số thứ tự A để vào phòng khám chuyên khoa Tim mạch.`;

    await this.send(
      params.to,
      `[Phòng khám Tim mạch 4AM] Xác nhận đăng ký lịch khám thành công — Mã ${params.appointmentCode}`,
      html,
      text,
    );

    this.logger.log(`Đã gửi email xác nhận đặt lịch ${params.appointmentCode} tới ${params.to}`);
  }
}