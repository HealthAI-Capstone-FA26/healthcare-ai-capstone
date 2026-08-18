import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

interface UpsertOtpInput {
  email: string;
  fullName: string;
  phoneNumber?: string | null;
  actorRole: string;
  passwordHash: string;
  otpCodeHash: string;
  otpExpiresAt: Date;
}

type TxClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class RegistrationOtpService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.registrationOtp.findUnique({ where: { email } });
  }

  upsert(input: UpsertOtpInput) {
    const { email, ...data } = input;
    return this.prisma.registrationOtp.upsert({
      where: { email }, 
      create: { email, ...data, attempts: 0 }, //không thấy thì create 
      update: { ...data, attempts: 0 },// có email thì update
    });
  }
  incrementAttempts(email: string) {
    return this.prisma.registrationOtp.update({
      where: { email },
      data: { attempts: { increment: 1 } },
    });
  }

  delete(email: string, tx: TxClient = this.prisma) {
    return tx.registrationOtp.delete({ where: { email } });
  }
}