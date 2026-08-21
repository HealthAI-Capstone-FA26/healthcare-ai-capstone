import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { MAX_OTP_ATTEMPTS } from './auth.constants';
import { compareOtp } from './otp.util';

export interface PendingOtpLike {
  otpExpiresAt: Date;
  attempts: number;
  otpCodeHash: string;
}

export interface OtpValidationMessages {
  expired: string;
  maxAttemptsExceeded: string;
  invalidOtp: string;
}

// Codebase reuse for different otp strategies
export async function assertOtpValid(
  pending: PendingOtpLike,
  submittedOtp: string,
  messages: OtpValidationMessages,
  hooks: {
    onExpiredOrMaxAttempts: () => Promise<void>; // thường là xóa record trong Redis
    onWrongAttempt: () => Promise<void>; // thường là tăng đếm attempts
  },
): Promise<void> {
  if (pending.otpExpiresAt.getTime() < Date.now()) {
    await hooks.onExpiredOrMaxAttempts();
    throw new BadRequestException(messages.expired);
  }

  if (pending.attempts >= MAX_OTP_ATTEMPTS) {
    await hooks.onExpiredOrMaxAttempts();
    throw new BadRequestException(messages.maxAttemptsExceeded);
  }

  const isOtpValid = await compareOtp(submittedOtp, pending.otpCodeHash);
  if (!isOtpValid) {
    await hooks.onWrongAttempt();
    throw new UnauthorizedException(messages.invalidOtp);
  }
}
