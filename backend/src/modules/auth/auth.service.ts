import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { UserService } from '../user/user.service';
import { RegistrationOtpService } from './registration-otp.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

const SALT_ROUNDS = 10;
const OTP_LENGTH = 6;
const MAX_OTP_ATTEMPTS = 5;
const DEFAULT_ACTOR_ROLE = 'patient';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userService: UserService,
    private readonly registrationOtpService: RegistrationOtpService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  private generateOtp(): string {
    return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');// tạo mã otp có OTP_LENGHT chữ số
  }

  private getOtpExpiryMinutes(): number {
    return Number(this.configService.get<string>('OTP_EXPIRES_MINUTES') ?? 5);
  }

  async register(dto: RegisterDto): Promise<{message: string}>{
    const existingUser = await this.userService.findByEmail(dto.email)
    if(existingUser){
        throw new ConflictException('Email đã được đăng ký');
    }

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const otp = this.generateOtp();
    const otpCodeHash = await bcrypt.hash(otp, SALT_ROUNDS);
    const otpExpiresAt = new Date(Date.now() + this.getOtpExpiryMinutes() * 60_000);

    await this.registrationOtpService.upsert({
      email: dto.email,
      fullName: dto.fullName,
      phoneNumber: dto.phoneNumber,
      actorRole: dto.actorRole ?? DEFAULT_ACTOR_ROLE,
      passwordHash,
      otpCodeHash,
      otpExpiresAt,
    });

    await this.mailService.sendOtpMail(dto.email, otp);

    return { message: 'Đã gửi mã OTP xác thực tới email của bạn' };
  }

  async verifyOtp(dto: VerifyOtpDto){
    const pending =  await this.registrationOtpService.findByEmail(dto.email);

    if (!pending) {
      throw new BadRequestException('Không tìm thấy yêu cầu đăng ký cho email này');
    }
    if (pending.otpExpiresAt.getTime() < Date.now()) {
      await this.registrationOtpService.delete(dto.email);
      throw new BadRequestException('Mã OTP đã hết hạn, vui lòng đăng ký lại');
    }

    if (pending.attempts >= MAX_OTP_ATTEMPTS) {
      await this.registrationOtpService.delete(dto.email);
      throw new BadRequestException(
        'Bạn đã nhập sai OTP quá số lần cho phép, vui lòng đăng ký lại',
      );
    }
   
    const isOtpValid = await bcrypt.compare(dto.otp, pending.otpCodeHash);

    if (!isOtpValid) {
      await this.registrationOtpService.incrementAttempts(dto.email);
      throw new UnauthorizedException('Mã OTP không chính xác');
    }

    const defaultRole = await this.userService.findDefaultRole();

    const user = await this.prisma.$transaction(async (tx) => {
      const createUser = await this.userService.createVerifiedUser(
        {
          email: pending.email,
          passwordHash: pending.passwordHash,
          actorRole: pending.actorRole,
          fullName: pending.fullName,
          phoneNumber: pending.phoneNumber,
          defaultRoleId: defaultRole?.roleId,
        },
        tx,
      );

      await this.registrationOtpService.delete(pending.email, tx)

      return createUser
    })

    return {
      message:'Xác thực OTP thành công, tài khoản đã được tạo',
      user: this.userService.toResponseDto(user)
    };
  }
}