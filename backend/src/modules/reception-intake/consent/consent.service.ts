import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { CreateConsentDto } from './dto/create-consent.dto';
import { RevokeConsentDto } from './dto/revoke-consent.dto';
import { FindConsentsQueryDto } from './dto/find-consent-query.dto';

const CONSENT_STATUS_ACTIVE = 'active';
const CONSENT_STATUS_REVOKED = 'revoked';

@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  // POST /consents — ipAddress/deviceInfo lấy TỪ REQUEST, không nhận từ body người dùng gửi lên,
  // để tránh giả mạo nguồn gốc chữ ký (giá trị pháp lý dùng để đối soát sau này).
  async create(dto: CreateConsentDto, currentUser: RequestUser, req: Request) {
    const patient = await this.prisma.patient.findUnique({ where: { patientId: dto.patientId } });
    if (!patient) {
      throw new NotFoundException('Không tìm thấy bệnh nhân');
    }
    const policy = await this.prisma.consentPolicy.findUnique({ where: { policyId: dto.policyId } });
    if (!policy) {
      throw new NotFoundException('Không tìm thấy policy');
    }

    return this.prisma.consent.create({
      data: {
        patientId: dto.patientId,
        encounterId: dto.encounterId,
        policyId: dto.policyId,
        signatureType: dto.signatureType,
        signatureDataUrl: dto.signatureDataUrl,
        signedAt: new Date(),
        witnessedByUserId: dto.witnessedAtCounter ? currentUser.userId : null,
        ipAddress: req.ip,
        deviceInfo: req.headers['user-agent'],
        status: CONSENT_STATUS_ACTIVE,
      },
    });
  }

  // PATCH /consents/:id/revoke — bệnh nhân có quyền rút lại sự đồng ý theo luật; giữ lại lịch sử
  // (không xoá dòng), chỉ đổi status + ghi lại thời điểm/lý do.
  async revoke(consentId: string, dto: RevokeConsentDto) {
    const consent = await this.prisma.consent.findUnique({ where: { consentId } });
    if (!consent) {
      throw new NotFoundException('Không tìm thấy consent');
    }
    if (consent.status === CONSENT_STATUS_REVOKED) {
      throw new BadRequestException('Consent này đã được thu hồi trước đó');
    }

    return this.prisma.consent.update({
      where: { consentId },
      data: {
        status: CONSENT_STATUS_REVOKED,
        revokedAt: new Date(),
        revokeReason: dto.revokeReason,
      },
    });
  }

  async findMany(query: FindConsentsQueryDto) {
    return this.prisma.consent.findMany({
      where: {
        patientId: query.patientId,
        status: query.status,
        policy: query.policyType ? { policyType: query.policyType } : undefined,
      },
      include: { policy: true },
      orderBy: { signedAt: 'desc' },
    });
  }

  /**
   * Helper nội bộ (KHÔNG phải HTTP endpoint) — dùng ở Phase 7 (EncounterService.completeRegistration)
   * để kiểm tra bệnh nhân mới đã có consent active loại `policyType` (vd 'data_processing') chưa,
   * trước khi cho phép ENCOUNTERS.status chuyển sang 'registered'. Dùng index
   * Consent(patientId, status) đã thêm ở Phase 0 để tra nhanh.
   */
  async hasActivePolicyConsent(patientId: string, policyType: string): Promise<boolean> {
    const consent = await this.prisma.consent.findFirst({
      where: {
        patientId,
        status: CONSENT_STATUS_ACTIVE,
        policy: { policyType },
      },
    });
    return Boolean(consent);
  }
}