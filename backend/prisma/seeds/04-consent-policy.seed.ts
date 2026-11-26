import { HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from 'prisma/prisma.service';
import { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_BY_CODE } from './legal/legal-documents.manifest';

/**
 * Danh mục chính sách đồng ý (ConsentPolicy) — bảng danh mục KHÔNG có endpoint tạo mới qua API
 * (ConsentPolicyController chỉ có GET /consent-policies?policyType=). ConsentService.create()
 * bắt buộc có policyId hợp lệ (POST /consents) và hasActivePolicyConsent() tra theo `policyType`,
 * nên bảng này cần seed sẵn, tương tự LabRoom.
 *
 * ── Phạm vi (đồ án) ─────────────────────────────────────────────────────────────────────────
 * Cơ sở không có phiếu đồng ý do pháp lý soạn, nên `contentUrl` của mỗi policy trỏ tới văn bản
 * luật làm căn cứ chính (xem `primaryLegalDoc`). Đây là văn bản quy phạm, KHÔNG phải mẫu phiếu
 * bệnh nhân ký — nếu triển khai thực tế phải thay bằng phiếu do bộ phận pháp lý soạn/duyệt.
 *
 * ── Lưu trữ: Supabase Storage qua S3 API, bucket `capstone` (public) ─────────────────────────
 *   legal-documents/<CODE>/<file>.pdf
 * `contentUrl` = `${S3_PUBLIC_URL}/<key>`. Bucket public: chỉ để văn bản luật; KHÔNG đặt dữ liệu
 * bệnh nhân hay phiếu đã ký vào đây.
 *
 * ── Biến môi trường ─────────────────────────────────────────────────────────────────────────
 *   S3_ENDPOINT, S3_REGION, S3_PUBLIC_URL     (đã có)
 *   S3_ACCESS_KEY, S3_SECRET_KEY    (bắt buộc để upload; tạo ở Supabase > Storage > S3 Connection)
 *   S3_BUCKET                                 (mặc định: "capstone", suy ra từ S3_PUBLIC_URL)
 *   SEED_SKIP_STORAGE=true                    (chỉ seed DB, không upload)
 *   SEED_ALLOW_MISSING_DOCS=true              (không còn cần: văn bản phụ thiếu file chỉ bị cảnh báo)
 */

const LEGAL_PREFIX = 'legal-documents';
const FILES_ROOT = join(__dirname);

interface PolicySeed {
    policyCode: string;
    policyType: string;
    version: string;
    /** Văn bản luật chính dùng làm nội dung (contentUrl) của policy */
    primaryLegalDoc: string;
    /** Mã văn bản pháp lý trong manifest làm căn cứ */
    /** Toàn bộ văn bản căn cứ (để tham chiếu) */
    legalBasis: string[];
    effectiveFrom: Date;
    effectiveTo: Date | null;
}

// Hai văn bản về dữ liệu cá nhân có hiệu lực 01/01/2026 nên giữ mốc hiệu lực chung.
const EFFECTIVE_FROM = new Date('2026-01-01');

const POLICIES: PolicySeed[] = [
    {
        // Xử lý dữ liệu cá nhân, gồm dữ liệu sức khỏe (dữ liệu nhạy cảm) và hồ sơ bệnh án điện tử.
        policyCode: 'CONSENT-DATA-PROCESSING-V1',
        policyType: 'data_processing',
        version: 'v1.0',
        primaryLegalDoc: 'LAW-PDPL-91-2025',
        legalBasis: ['LAW-PDPL-91-2025', 'DECREE-356-2025', 'LAW-KCB-2023-CONSOLIDATED', 'CIRCULAR-13-2025-BYT'],
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
    },
    {
        // Đồng ý khám, chữa bệnh sau khi được thông tin, giải thích (Luật KCB Điều 9, 11).
        policyCode: 'CONSENT-TREATMENT-V1',
        policyType: 'treatment_consent',
        version: 'v1.0',
        primaryLegalDoc: 'LAW-KCB-2023-CONSOLIDATED',
        legalBasis: ['LAW-KCB-2023-CONSOLIDATED'],
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
    },
    {
        // Nghĩa vụ chi trả, quyền được giải thích chi phí (Luật KCB Điều 12, 18). Phần BHYT cần thẩm định riêng.
        policyCode: 'CONSENT-FINANCIAL-RESPONSIBILITY-V1',
        policyType: 'financial_responsibility',
        version: 'v1.0',
        primaryLegalDoc: 'LAW-KCB-2023-CONSOLIDATED',
        legalBasis: ['LAW-KCB-2023-CONSOLIDATED'],
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
    },
    {
        // Thủ thuật/can thiệp có xâm nhập cơ thể (vd: thăm dò tim mạch xâm lấn) — Luật KCB Điều 65.
        policyCode: 'CONSENT-INVASIVE-PROCEDURE-V1',
        policyType: 'invasive_procedure_consent',
        version: 'v1.0',
        primaryLegalDoc: 'LAW-KCB-2023-CONSOLIDATED',
        legalBasis: ['LAW-KCB-2023-CONSOLIDATED'],
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
    },
    {
        // Từ chối khám/chữa bệnh hoặc rời cơ sở trái chỉ định: phải cam kết bằng văn bản — Luật KCB Điều 13.
        policyCode: 'CONSENT-REFUSAL-V1',
        policyType: 'refusal_of_treatment',
        version: 'v1.0',
        primaryLegalDoc: 'LAW-KCB-2023-CONSOLIDATED',
        legalBasis: ['LAW-KCB-2023-CONSOLIDATED'],
        effectiveFrom: EFFECTIVE_FROM,
        effectiveTo: null,
    },
];

// ─────────────────────────────── Storage helpers ───────────────────────────────

interface Storage {
    client: S3Client;
    bucket: string;
    publicUrl: string;
}

function envFlag(name: string): boolean {
    return (process.env[name] ?? '').toLowerCase() === 'true';
}

function publicBaseUrl(): string {
    const url = process.env.S3_PUBLIC_URL;
    if (!url) throw new Error('Thiếu S3_PUBLIC_URL.');
    return url.replace(/\/+$/, '');
}

function getStorage(): Storage | null {
    if (envFlag('SEED_SKIP_STORAGE')) return null;
    const { S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
    if (!S3_ENDPOINT || !S3_REGION || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
        throw new Error('Thiếu S3_ENDPOINT / S3_REGION / S3_ACCESS_KEY / S3_SECRET_KEY (hoặc SEED_SKIP_STORAGE=true).');
    }
    const publicUrl = publicBaseUrl();
    return {
        client: new S3Client({
            endpoint: S3_ENDPOINT,
            region: S3_REGION,
            forcePathStyle: true, // Supabase S3 yêu cầu path-style
            credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
        }),
        bucket: process.env.S3_BUCKET ?? publicUrl.split('/').pop()!,
        publicUrl,
    };
}

/** PutObject ghi đè nếu key đã tồn tại nên seed chạy lại an toàn. Thiếu file local -> cảnh báo và bỏ qua. */
async function uploadPdf(storage: Storage, key: string, localPath: string): Promise<boolean> {
    if (!existsSync(localPath)) {
        console.warn(`  ! thiếu file local, bỏ qua upload: ${localPath}`);
        return false;
    }
    const body = await readFile(localPath);
    if (body.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new Error(`${localPath} không phải PDF hợp lệ.`);
    }
    await storage.client.send(
        new PutObjectCommand({
            Bucket: storage.bucket,
            Key: key,
            Body: body,
            ContentType: 'application/pdf',
            CacheControl: 'public, max-age=3600',
        }),
    );
    const sha = createHash('sha256').update(body).digest('hex').slice(0, 12);
    console.log(`  ↑ ${storage.bucket}/${key} (sha256:${sha}…)`);
    return true;
}

function legalKey(code: string): string {
    const doc = LEGAL_DOCUMENT_BY_CODE.get(code)!;
    return `${LEGAL_PREFIX}/${doc.code}/${doc.localFile}`;
}

async function uploadLegalDocuments(storage: Storage): Promise<void> {
    for (const doc of LEGAL_DOCUMENTS) {
        const ok = await uploadPdf(storage, legalKey(doc.code), join(FILES_ROOT, 'legal', 'files', doc.localFile));
        if (ok && !doc.verified) console.warn(`  ! ${doc.code} chưa được xác thực với nguồn chính thống — cần rà soát pháp lý.`);
    }
}

// ─────────────────────────────────── Seed ───────────────────────────────────

export async function seedConsentPolicies(prisma: PrismaService): Promise<void> {
    for (const p of POLICIES) {
        if (!p.legalBasis.includes(p.primaryLegalDoc)) throw new Error(`${p.policyCode}: primaryLegalDoc phải nằm trong legalBasis`);
        for (const code of p.legalBasis) {
            if (!LEGAL_DOCUMENT_BY_CODE.has(code)) throw new Error(`${p.policyCode}: legalBasis không có trong manifest: ${code}`);
        }
    }

    const storage = getStorage();
    if (storage) {
        await storage.client.send(new HeadBucketCommand({ Bucket: storage.bucket })); // fail sớm nếu sai bucket/key
        console.log('Uploading legal documents…');
        await uploadLegalDocuments(storage);
    } else {
        console.log('SEED_SKIP_STORAGE=true — bỏ qua upload, chỉ seed DB.');
    }

    for (const p of POLICIES) {
        const data = {
            policyType: p.policyType,
            version: p.version,
            contentUrl: `${publicBaseUrl()}/${legalKey(p.primaryLegalDoc)}`,
            effectiveFrom: p.effectiveFrom,
            effectiveTo: p.effectiveTo,
        };
        await prisma.consentPolicy.upsert({
            where: { policyCode: p.policyCode },
            update: data,
            create: { policyCode: p.policyCode, ...data },
        });
    }

    const count = await prisma.consentPolicy.count();
    console.log(`Seeded consent policies, total in DB: ${count}`);
}