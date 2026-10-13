import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { FindConsentPoliciesQueryDto } from './dto/find-consent-policy-query.dto';

@Injectable()
export class ConsentPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  // GET /consent-policies?policyType= — trả về policy ĐANG HIỆU LỰC tại thời điểm hiện tại
  // (effectiveFrom <= hôm nay <= effectiveTo, hoặc effectiveTo NULL = vô thời hạn). Nếu nhiều
  // policy cùng type thoả điều kiện (không nên xảy ra nếu vận hành đúng, nhưng vẫn có thể do
  // effectiveTo của bản cũ chưa được đóng), lấy bản có effectiveFrom mới nhất.
  async findEffective(query: FindConsentPoliciesQueryDto) {
    const today = new Date();
    return this.prisma.consentPolicy.findMany({
      where: {
        policyType: query.policyType,
        effectiveFrom: { lte: today },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }
}