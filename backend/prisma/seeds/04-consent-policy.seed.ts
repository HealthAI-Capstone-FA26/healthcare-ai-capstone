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
 * ── Quy tắc: 1 văn bản pháp lý (manifest) <-> 1 ConsentPolicy <-> 1 file PDF ────────────────
 * Có đúng 4 văn bản trong manifest nên có đúng 4 policy; mỗi policy có `contentUrl` riêng,
 * trỏ tới PDF của văn bản tương ứng. Seed sẽ báo lỗi nếu hai policy dùng chung một văn bản,
 * hoặc nếu có văn bản trong manifest mà không có policy.
 *
 * ── Phạm vi (đồ án) ─────────────────────────────────────────────────────────────────────────
 * Cơ sở không có phiếu đồng ý do pháp lý soạn, nên `contentUrl` trỏ tới văn bản luật làm căn cứ.
 * Đây là văn bản quy phạm, KHÔNG phải mẫu phiếu bệnh nhân ký — nếu triển khai thực tế phải thay
 * bằng phiếu do bộ phận pháp lý soạn/duyệt.
 *
 * ── Lưu trữ: Supabase Storage qua S3 API, bucket `capstone` (public) ─────────────────────────
 *   legal-documents/<CODE>/<file>.pdf
 * `contentUrl` = `${S3_PUBLIC_URL}/<key>`. Bucket public: chỉ để văn bản luật; KHÔNG đặt dữ liệu
 * bệnh nhân hay phiếu đã ký vào đây.
 *
 * ── Biến môi trường ─────────────────────────────────────────────────────────────────────────
 *   S3_ENDPOINT, S3_REGION, S3_PUBLIC_URL
 *   S3_ACCESS_KEY, S3_SECRET_KEY    (bắt buộc để upload; tạo ở Supabase > Storage > S3 Connection)
 *   S3_BUCKET                       (mặc định: "capstone", suy ra từ S3_PUBLIC_URL)
 *   SEED_SKIP_STORAGE=true          (chỉ seed DB, không upload)
 */

const LEGAL_PREFIX = 'legal-documents';
const FILES_ROOT = join(__dirname);

interface PolicySeed {
    policyCode: string;
    policyType: string;
    version: string;
    /** Mã văn bản pháp lý trong manifest; PDF của văn bản này là `contentUrl` của policy */
    legalDoc: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
}

const POLICIES: PolicySeed[] = [
    {
        // Luật Bảo vệ dữ liệu cá nhân: đồng ý xử lý dữ liệu cá nhân, gồm dữ liệu sức khỏe.
        policyCode: 'CONSENT-DATA-PROCESSING-V1',
        policyType: 'data_processing',
        version: 'v1.0',
        legalDoc: 'LAW-PDPL-91-2025',
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
    },
    {
        // Nghị định 356/2025/NĐ-CP: hướng dẫn Luật BVDLCN; dữ liệu cá nhân nhạy cảm (gồm tình trạng sức khỏe).
        policyCode: 'CONSENT-SENSITIVE-DATA-V1',
        policyType: 'sensitive_data_processing',
        version: 'v1.0',
        legalDoc: 'DECREE-356-2025',
        effectiveFrom: new Date('2026-01-01'),
        effectiveTo: null,
    },
    {
        // Thông tư 13/2025/TT-BYT: lập, lưu trữ, khai thác hồ sơ bệnh án điện tử.
        policyCode: 'CONSENT-EMR-V1',
        policyType: 'electronic_medical_record',
        version: 'v1.0',
        legalDoc: 'CIRCULAR-13-2025-BYT',
        effectiveFrom: new Date('2025-07-21'),
        effectiveTo: null,
    },
    {
        // Luật KCB (bản hợp nhất): đồng ý khám, chữa bệnh sau khi được thông tin, giải thích.
        policyCode: 'CONSENT-TREATMENT-V1',
        policyType: 'treatment_consent',
        version: 'v1.0',
        legalDoc: 'LAW-KCB-2023-CONSOLIDATED',
        effectiveFrom: new Date('2024-01-01'),
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
    return (process.env[name] ?? '').trim().toLowerCase() === 'true';
}

function publicBaseUrl(): string {
    const url = process.env.S3_PUBLIC_URL?.trim();
    if (!url) throw new Error('Thiếu S3_PUBLIC_URL.');
    return url.replace(/\/+$/, '');
}

function getStorage(): Storage | null {
    if (envFlag('SEED_SKIP_STORAGE')) return null;
    const S3_ENDPOINT = process.env.S3_ENDPOINT?.trim();
    const S3_REGION = process.env.S3_REGION?.trim();
    const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY?.trim();
    const S3_SECRET_KEY = process.env.S3_SECRET_KEY?.trim();
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
        bucket: process.env.S3_BUCKET?.trim() || publicUrl.split('/').pop()!,
        publicUrl,
    };
}

/** PutObject ghi đè nếu key đã tồn tại nên seed chạy lại an toàn. */
async function uploadPdf(storage: Storage, key: string, localPath: string): Promise<void> {
    if (!existsSync(localPath)) {
        // Mỗi policy trỏ tới đúng 1 PDF, thiếu file nghĩa là contentUrl sẽ chết -> dừng seed.
        throw new Error(`Thiếu file local: ${localPath}. Chạy scripts/fetch-legal-documents.ts hoặc tải tay vào thư mục files/.`);
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
}

function legalKey(code: string): string {
    const doc = LEGAL_DOCUMENT_BY_CODE.get(code)!;
    return `${LEGAL_PREFIX}/${doc.code}/${doc.localFile}`;
}

async function uploadLegalDocuments(storage: Storage): Promise<void> {
    for (const doc of LEGAL_DOCUMENTS) {
        await uploadPdf(storage, legalKey(doc.code), join(FILES_ROOT, 'legal', 'files', doc.localFile));
        if (!doc.verified) console.warn(`  ! ${doc.code} chưa được xác thực với nguồn chính thống — cần rà soát pháp lý.`);
    }
}

// ─────────────────────────────────── Seed ───────────────────────────────────

function validatePolicies(): void {
    const used = new Set<string>();
    const codes = new Set<string>();
    const types = new Set<string>();
    for (const p of POLICIES) {
        if (!LEGAL_DOCUMENT_BY_CODE.has(p.legalDoc)) throw new Error(`${p.policyCode}: legalDoc không có trong manifest: ${p.legalDoc}`);
        if (used.has(p.legalDoc)) throw new Error(`${p.policyCode}: văn bản ${p.legalDoc} đã được policy khác dùng (phải 1-1).`);
        if (codes.has(p.policyCode)) throw new Error(`Trùng policyCode: ${p.policyCode}`);
        if (types.has(p.policyType)) throw new Error(`Trùng policyType: ${p.policyType}`);
        used.add(p.legalDoc);
        codes.add(p.policyCode);
        types.add(p.policyType);
    }
    for (const doc of LEGAL_DOCUMENTS) {
        if (!used.has(doc.code)) throw new Error(`Văn bản ${doc.code} trong manifest chưa có policy nào.`);
    }
}

export async function seedConsentPolicies(prisma: PrismaService): Promise<void> {
    validatePolicies();

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
            contentUrl: `${publicBaseUrl()}/${legalKey(p.legalDoc)}`,
            effectiveFrom: p.effectiveFrom,
            effectiveTo: p.effectiveTo,
        };
        await prisma.consentPolicy.upsert({
            where: { policyCode: p.policyCode },
            update: data,
            create: { policyCode: p.policyCode, ...data },
        });
    }

    // Dọn các policy cũ không còn trong danh sách (vd: FINANCIAL / INVASIVE / REFUSAL từ lần seed trước).
    // Nếu đã có consent tham chiếu tới policy cũ thì FK sẽ chặn xoá -> chỉ cảnh báo, không làm hỏng seed.
    const keep = POLICIES.map((p) => p.policyCode);
    const stale = await prisma.consentPolicy.findMany({ where: { policyCode: { notIn: keep } }, select: { policyCode: true } });
    for (const s of stale) {
        try {
            await prisma.consentPolicy.delete({ where: { policyCode: s.policyCode } });
            console.log(`  - đã xoá policy cũ: ${s.policyCode}`);
        } catch {
            console.warn(`  ! không xoá được ${s.policyCode} (đang được consent tham chiếu) — xử lý thủ công.`);
        }
    }

    const count = await prisma.consentPolicy.count();
    console.log(`Seeded consent policies, total in DB: ${count}`);
}