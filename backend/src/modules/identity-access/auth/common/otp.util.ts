import { randomInt } from 'crypto';
import * as bcrypt from 'bcrypt';
import { OTP_LENGTH, SALT_ROUNDS } from './auth.constants';

export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, '0');
}

export function hashOtp(otp: string): Promise<string> {
  return bcrypt.hash(otp, SALT_ROUNDS);
}

export function compareOtp(otp: string, otpCodeHash: string): Promise<boolean> {
  return bcrypt.compare(otp, otpCodeHash);
}

export function otpExpiryDate(expiryMinutes: number): Date {
  return new Date(Date.now() + expiryMinutes * 60_000);
}
