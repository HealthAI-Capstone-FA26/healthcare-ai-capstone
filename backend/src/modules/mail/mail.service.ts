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
}