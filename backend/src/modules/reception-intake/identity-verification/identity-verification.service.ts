import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { CreateIdentityVerificationDto, VerificationStatus } from './dto/create-identity-verification.dto';

@Injectable()
export class IdentityVerificationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /encounters/:encounterId/identity-verifications — đây là bảng LOG, mỗi lần gọi tạo
   * MỘT DÒNG MỚI (KHÔNG upsert): 1 encounter có thể xác minh thất bại nhiều lần trước khi thành
   * công (đúng comment "log nhiều dòng" trong module3.md mục 2).
   *
   * Khi verificationStatus = 'verified': cập nhật Patient.identityVerified = true VÀ
   * Patient.identityVerifiedAt = now() TRONG CÙNG transaction. identityVerifiedAt được ghi đè
   * MỖI LẦN verified thành công (không chỉ lần đầu) vì field này lưu "thời điểm xác minh thành
   * công gần nhất" — đúng theo mô tả trong module3.md mục 4, không phải "lần xác minh đầu tiên".
   */
  async create(encounterId: string, dto: CreateIdentityVerificationDto, currentUser: RequestUser) {
    const encounter = await this.prisma.encounter.findUnique({ where: { encounterId } });
    if (!encounter) {
      throw new NotFoundException('Không tìm thấy lượt khám');
    }

    return this.prisma.$transaction(async (tx) => {
      const verification = await tx.patientIdentityVerification.create({
        data: {
          encounterId,
          verifiedByUserId: currentUser.userId,
          verificationMethod: dto.verificationMethod,
          verificationStatus: dto.verificationStatus,
          mismatchNotes: dto.mismatchNotes,
          verifiedAt: new Date(),
        },
      });

      if (dto.verificationStatus === VerificationStatus.VERIFIED) {
        await tx.patient.update({
          where: { patientId: encounter.patientId },
          data: { identityVerified: true, identityVerifiedAt: verification.verifiedAt },
        });
      }

      return verification;
    });
  }

  // GET /encounters/:encounterId/identity-verifications — dùng index (encounterId, verifiedAt DESC)
  // đã thêm ở Phase 0 để lấy nhanh lịch sử xác minh của 1 lượt khám.
  async findByEncounterId(encounterId: string) {
    const verifications = await this.prisma.patientIdentityVerification.findMany({
      where: { encounterId },
      include: {
        verifiedByUser: {
          select: {
            userId: true,
            email: true,
            profile: {
              select: {
                fullName: true,
              },
            },
          },
        },
      },
      orderBy: { verifiedAt: 'desc' },
    });

    return verifications.map((v) => ({
      ...v,
      verifiedByUser: v.verifiedByUser
        ? {
            userId: v.verifiedByUser.userId,
            email: v.verifiedByUser.email,
            fullName: v.verifiedByUser.profile?.fullName || v.verifiedByUser.email,
          }
        : undefined,
    }));
  }
}