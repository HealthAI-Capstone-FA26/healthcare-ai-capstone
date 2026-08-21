import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token/token.service';
import { SessionService } from './session/session.service';
import { SecurityConfigService } from './security-config/security-config.service';
import { RegistrationOtpStore } from './registration/registration-otp.store';
import { RegistrationService } from './registration/registration.service';
import { LoginOtpStore } from './login/login-otp.store';
import { LoginService } from './login/login.service';
import { PasswordResetOtpStore } from './password/password-reset-otp.store';
import { PasswordService } from './password/password.service';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    UserModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN') ?? '15m') as StringValue,
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    JwtStrategy,

    // Hạ tầng dùng chung
    TokenService,
    SessionService,
    SecurityConfigService,

    // Đăng ký
    RegistrationOtpStore,
    RegistrationService,

    // Đăng nhập / refresh / logout
    LoginOtpStore,
    LoginService,

    // Đổi mật khẩu / quên mật khẩu
    PasswordResetOtpStore,
    PasswordService,
  ],
  // Không còn AuthService facade -> export thẳng 3 service theo domain,
  // module khác (nếu cần) import đúng cái mình dùng thay vì phải kéo theo cả khối auth.
  exports: [RegistrationService, LoginService, PasswordService],
})
export class AuthModule {}
