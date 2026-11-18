import { PrismaService } from 'prisma/prisma.service';

/**
 * Danh mục chính sách đồng ý (ConsentPolicy) — bảng danh mục KHÔNG có endpoint tạo mới qua API
 * (ConsentPolicyController chỉ có GET /consent-policies?policyType=, xem
 * consent-policy.service.ts), trong khi ConsentService.create() lại BẮT BUỘC phải có sẵn
 * policyId hợp lệ để bệnh nhân ký (POST /consents), và ConsentService.hasActivePolicyConsent()
 * (helper nội bộ dự kiến dùng ở luồng hoàn tất đăng ký khám — xem comment "Phase 7" trong
 * consent.service.ts) tra theo `policyType`. Do đó bảng này cũng cần seed sẵn tương tự LabRoom,
 * nếu không hệ thống sẽ không có policy nào để lễ tân/bệnh nhân ký khi tiếp nhận.
 *
 * contentUrl bên dưới là đường dẫn tài liệu mẫu (placeholder) — đội ngũ vận hành/pháp lý cần
 * thay bằng URL tài liệu chính sách thật (PDF nội bộ hoặc trên CDN) trước khi lên production.
 */
export async function seedConsentPolicies(prisma: PrismaService): Promise<void> {
    const effectiveFrom = new Date('2026-01-01');

    const policies = [
        {
            policyCode: 'CONSENT-DATA-PROCESSING-V1',
            policyType: 'data_processing',
            version: 'v1.0',
            contentUrl: '/legal/consents/data-processing-v1.pdf',
            effectiveFrom,
            effectiveTo: null,
        },
        {
            policyCode: 'CONSENT-TREATMENT-V1',
            policyType: 'treatment_consent',
            version: 'v1.0',
            contentUrl: '/legal/consents/treatment-consent-v1.pdf',
            effectiveFrom,
            effectiveTo: null,
        },
        {
            policyCode: 'CONSENT-FINANCIAL-RESPONSIBILITY-V1',
            policyType: 'financial_responsibility',
            version: 'v1.0',
            contentUrl: '/legal/consents/financial-responsibility-v1.pdf',
            effectiveFrom,
            effectiveTo: null,
        },
    ];

    for (const item of policies) {
        await prisma.consentPolicy.upsert({
            where: { policyCode: item.policyCode },
            update: {
                policyType: item.policyType,
                version: item.version,
                contentUrl: item.contentUrl,
                effectiveFrom: item.effectiveFrom,
                effectiveTo: item.effectiveTo,
            },
            create: item,
        });
    }

    const count = await prisma.consentPolicy.count();
    console.log(`Seeded consent policies, total in DB: ${count}`);
}
