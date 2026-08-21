import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../../prisma/prisma.service';
import { MailService } from '../../mail/mail.service';
import { UserService } from '../../user/user.service';
import { RegistrationOtpStore } from './registration-otp.store';
import { RegisterDto } from '../dto/register.dto';
import { VerifyOtpDto } from '../dto/verify-otp.dto';
import { DEFAULT_ACTOR_ROLE, SALT_ROUNDS } from '../common/auth.constants';
import { generateOtp, hashOtp, otpExpiryDate } from '../common/otp.util';
import { assertOtpValid } from '../common/otp-validation.util';

// ================== ĐĂNG KÝ (2 bước: gửi OTP -> verify OTP tạo tài khoản) ==================
@Injectable()
export class RegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    private readonly registrationOtpStore: RegistrationOtpStore,
  ) { }

  private getOtpExpiryMinutes(): number {
    return Number(this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? 5);
  }

  // Bước 1: gửi OTP qua mail
  async register(dto: RegisterDto): Promise<{ message: string }> {
    const existingUser = await this.userService.findByEmail(dto.email);
    if (existingUser) {
      throw new ConflictException('Email đã được đăng ký');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const otp = generateOtp();
    const otpCodeHash = await hashOtp(otp);
    const otpExpiresAt = otpExpiryDate(this.getOtpExpiryMinutes());

    await this.registrationOtpStore.upsert(dto.email, {
      email: dto.email,
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber,
      avatarUrl: dto.avatarUrl,
      actorRole: DEFAULT_ACTOR_ROLE,
      passwordHash,
      otpCodeHash,
      otpExpiresAt,
    });

    await this.mailService.sendOtpMail(dto.email, otp);

    return { message: 'Đã gửi mã OTP xác thực tới email của bạn' };
  }

  // Bước 2: verify OTP -> tạo tài khoản thật trong DB
  async verifyOtp(dto: VerifyOtpDto) {
    const pending = await this.registrationOtpStore.find(dto.email);

    if (!pending) {
      throw new BadRequestException('Không tìm thấy yêu cầu đăng ký cho email này');
    }

    await assertOtpValid(
      pending,
      dto.otp,
      {
        expired: 'Mã OTP đã hết hạn, vui lòng đăng ký lại',
        maxAttemptsExceeded: 'Bạn đã nhập sai OTP quá số lần cho phép, vui lòng đăng ký lại',
        invalidOtp: 'Mã OTP không chính xác',
      },
      {
        onExpiredOrMaxAttempts: () => this.registrationOtpStore.delete(dto.email),
        onWrongAttempt: () => this.registrationOtpStore.incrementAttempts(dto.email).then(() => undefined),
      },
    );

    const defaultRole = await this.userService.findDefaultRole();

    const user = await this.prisma.$transaction(async (tx) => {
      return this.userService.createVerifiedUser(
        {
          email: pending.email,
          passwordHash: pending.passwordHash,
          actorRole: pending.actorRole,
          fullName: pending.fullName,
          phoneNumber: pending.phoneNumber,
          avatarUrl: pending.avatarUrl,
          defaultRoleId: defaultRole?.roleId,
        },
        tx,
      );
    });

    // Redis không tham gia transaction Postgres nên xóa OTP sau khi user đã tạo thành công
    await this.registrationOtpStore.delete(pending.email);

    return {
      message: 'Xác thực OTP thành công, tài khoản đã được tạo',
      user: this.userService.toResponseDto(user),
    };
  }
}
