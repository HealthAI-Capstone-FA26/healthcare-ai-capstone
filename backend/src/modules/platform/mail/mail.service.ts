import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {
    this.transporter = nodemailer.createTransport({
      host: this.configService.getOrThrow<string>('MAIL_HOST'),
      port: Number(this.configService.getOrThrow<string>('MAIL_PORT')),
      secure: this.configService.get<string>('MAIL_SECURE') === 'true',
      auth: {
        user: this.configService.getOrThrow<string>('MAIL_USER'),
        pass: this.configService.getOrThrow<string>('MAIL_PASS'),
      },
    });
  }

  async sendOtpMail(to: string, otp: string): Promise<void> {
    const from =
      this.configService.get<string>('MAIL_FROM') ??
      this.configService.getOrThrow<string>('MAIL_USER');
    const expiresMinutes = this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? '5';

    await this.transporter.sendMail({
      from,
      to,
      subject: 'Mã xác thực đăng ký tài khoản',
      html: `
        <p>Xin chào,</p>
        <p>Mã OTP xác thực đăng ký tài khoản của bạn là:</p>
        <h2 style="letter-spacing: 4px;">${otp}</h2>
        <p>Mã có hiệu lực trong ${expiresMinutes} phút. Vui lòng không chia sẻ mã này cho bất kỳ ai.</p>
      `,
    });

    this.logger.log(`Đã gửi OTP đăng ký tới ${to}`);
  }

  async sendLoginOtpMail(to: string, otp: string): Promise<void> {
    const from =
      this.configService.get<string>('MAIL_FROM') ??
      this.configService.getOrThrow<string>('MAIL_USER');
    const expiresMinutes = this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? '5';

    await this.transporter.sendMail({
      from,
      to,
      subject: 'Mã xác thực đăng nhập (MFA)',
      html: `
        <p>Xin chào,</p>
        <p>Mã OTP xác thực đăng nhập của bạn là:</p>
        <h2 style="letter-spacing: 4px;">${otp}</h2>
        <p>Mã có hiệu lực trong ${expiresMinutes} phút. Nếu không phải bạn đăng nhập, vui lòng đổi mật khẩu ngay.</p>
      `,
    });

    this.logger.log(`Đã gửi OTP đăng nhập tới ${to}`);
  }

  async sendGuestAppointmentOtpMail(to: string, otp: string): Promise<void> {
    const from =
      this.configService.get<string>('MAIL_FROM') ??
      this.configService.getOrThrow<string>('MAIL_USER');
    const expiresMinutes = this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? '5';

    await this.transporter.sendMail({
      from,
      to,
      subject: 'Mã xác thực đặt lịch khám',
      html: `
        <p>Xin chào,</p>
        <p>Mã OTP xác thực đặt lịch khám của bạn là:</p>
        <h2 style="letter-spacing: 4px;">${otp}</h2>
        <p>Mã có hiệu lực trong ${expiresMinutes} phút. Vui lòng không chia sẻ mã này cho bất kỳ ai.</p>
      `,
    });

    this.logger.log(`Đã gửi OTP đặt lịch guest tới ${to}`);
  }

  async sendPasswordResetOtpMail(to: string, otp: string): Promise<void> {
    const from =
      this.configService.get<string>('MAIL_FROM') ??
      this.configService.getOrThrow<string>('MAIL_USER');
    const expiresMinutes = this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? '5';

    await this.transporter.sendMail({
      from,
      to,
      subject: 'Mã xác thực đặt lại mật khẩu',
      html: `
        <p>Xin chào,</p>
        <p>Mã OTP đặt lại mật khẩu của bạn là:</p>
        <h2 style="letter-spacing: 4px;">${otp}</h2>
        <p>Mã có hiệu lực trong ${expiresMinutes} phút. Nếu không phải bạn yêu cầu, vui lòng bỏ qua email này.</p>
      `,
    });

    this.logger.log(`Đã gửi OTP đặt lại mật khẩu tới ${to}`);
  }

  /** Email thông báo nghiệp vụ (worker thông báo SE07 gọi): nội dung text thuần, được escape HTML. */
  async sendPlainMail(to: string, subject: string, text: string): Promise<void> {
    const from =
      this.configService.get<string>('MAIL_FROM') ??
      this.configService.getOrThrow<string>('MAIL_USER');
    const escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br/>');

    await this.transporter.sendMail({ from, to, subject, text, html: `<p>${escaped}</p>` });
    this.logger.log(`Đã gửi email thông báo tới ${to}`);
  }
}