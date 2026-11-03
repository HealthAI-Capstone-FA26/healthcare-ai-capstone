import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import * as forge from 'node-forge';
import { PkiAuthority } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { PkiKeyVaultService } from './pki-key-vault.service';
import { AUTHORITY_KIND } from './pki.types';
import {
    certFingerprintSha256,
    certsToPem,
    dnToString,
    generateRsaKeyPair,
    parseCertificatesPem,
    randomSerialHex,
    toForgePrivateKey,
    utf8Value,
} from './pki-x509.util';

export interface LoadedCa {
    authority: PkiAuthority;
    cert: forge.pki.Certificate;
    privateKey: forge.pki.rsa.PrivateKey;
}

export interface LeafCertificateRequest {
    publicKeyPem: string;
    commonName: string;
    organizationalUnit?: string;
    serialNumberAttr?: string; // vd. số chứng chỉ hành nghề
    email?: string;
    validDays: number;
}

/** 4096 bit cho production; PKI_ROOT_CA_BITS chỉ nên hạ xuống (2048) trong test để chạy nhanh. */
const rootCaBits = () => (Number(process.env.PKI_ROOT_CA_BITS) >= 2048 ? Number(process.env.PKI_ROOT_CA_BITS) : 4096);
const ROOT_CA_VALID_YEARS = 10;
const ADVISORY_LOCK_KEY = 727001; // khoá advisory tránh 2 tiến trình cùng tạo Root CA

/**
 * Quản lý CA nội bộ (Root CA) và danh sách CA tin cậy bên ngoài.
 *  - Root CA được tự tạo ở lần dùng đầu tiên, private key mã hoá AES-256-GCM trong DB.
 *  - Trust anchors = mọi PkiAuthority (root nội bộ + CA ngoài đã được admin thêm vào).
 *
 * LƯU Ý PHÁP LÝ: CA nội bộ đảm bảo toàn vẹn + chống chối bỏ TRONG hệ thống. Để chữ ký có giá trị pháp lý
 * theo NĐ 130/2018/NĐ-CP, chứng thư của bác sĩ phải do tổ chức cung cấp dịch vụ chứng thực chữ ký số được cấp phép
 * (VNPT-CA, Viettel-CA, FPT-CA, ...) — dùng luồng "import .p12" + "thêm CA tin cậy" của module này.
 */
@Injectable()
export class PkiAuthorityService {
    private readonly logger = new Logger(PkiAuthorityService.name);
    private cachedCa?: LoadedCa;

    constructor(
        private readonly prisma: PrismaService,
        private readonly vault: PkiKeyVaultService,
    ) {}

    private orgName(): string {
        return process.env.PKI_ORG_NAME?.trim() || 'HealthAI Cardiology Clinic';
    }

    private load(authority: PkiAuthority): LoadedCa {
        if (!authority.encryptedPrivateKey) {
            throw new BadRequestException('Authority này không giữ private key (CA ngoài) nên không thể cấp chứng thư.');
        }
        const [cert] = parseCertificatesPem(authority.certPem);
        const privateKey = toForgePrivateKey(this.vault.decrypt(authority.encryptedPrivateKey));
        return { authority, cert, privateKey };
    }

    /** Lấy Root CA nội bộ đang active; chưa có thì tạo mới (an toàn khi chạy song song). */
    async getOrCreateRootCa(): Promise<LoadedCa> {
        if (this.cachedCa) return this.cachedCa;

        const existing = await this.prisma.pkiAuthority.findFirst({
            where: { kind: AUTHORITY_KIND.INTERNAL_ROOT, status: 'active' },
            orderBy: { createdAt: 'desc' },
        });
        if (existing) return (this.cachedCa = this.load(existing));

        const { privateKeyPem, publicKeyPem } = await generateRsaKeyPair(rootCaBits());
        const cert = forge.pki.createCertificate();
        cert.publicKey = forge.pki.publicKeyFromPem(publicKeyPem);
        cert.serialNumber = randomSerialHex();
        const now = Date.now();
        cert.validity.notBefore = new Date(now - 5 * 60 * 1000);
        cert.validity.notAfter = new Date(now);
        cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + ROOT_CA_VALID_YEARS);
        const attrs = [
            { name: 'commonName', value: utf8Value(`${this.orgName()} Root CA`) },
            { name: 'organizationName', value: utf8Value(this.orgName()) },
            { name: 'countryName', value: 'VN' },
        ];
        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.setExtensions([
            { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
            { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
            { name: 'subjectKeyIdentifier' },
        ]);
        cert.sign(toForgePrivateKey(privateKeyPem), forge.md.sha256.create());

        const created = await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY})`;
            const raced = await tx.pkiAuthority.findFirst({ where: { kind: AUTHORITY_KIND.INTERNAL_ROOT, status: 'active' } });
            if (raced) return raced;
            return tx.pkiAuthority.create({
                data: {
                    kind: AUTHORITY_KIND.INTERNAL_ROOT,
                    subjectDn: dnToString(cert.subject.attributes),
                    serialNumber: cert.serialNumber,
                    fingerprintSha256: certFingerprintSha256(cert),
                    certPem: forge.pki.certificateToPem(cert),
                    encryptedPrivateKey: this.vault.encrypt(privateKeyPem),
                    notBefore: cert.validity.notBefore,
                    notAfter: cert.validity.notAfter,
                },
            });
        });
        this.logger.log(`Đã khởi tạo Root CA nội bộ: ${created.subjectDn} (SHA-256 ${created.fingerprintSha256})`);
        return (this.cachedCa = this.load(created));
    }

    /** Cấp chứng thư người dùng cuối (bác sĩ) do Root CA nội bộ ký. */
    async issueLeafCertificate(req: LeafCertificateRequest): Promise<{ cert: forge.pki.Certificate; authority: PkiAuthority }> {
        const ca = await this.getOrCreateRootCa();
        const cert = forge.pki.createCertificate();
        cert.publicKey = forge.pki.publicKeyFromPem(req.publicKeyPem);
        cert.serialNumber = randomSerialHex();

        const now = Date.now();
        cert.validity.notBefore = new Date(now - 5 * 60 * 1000);
        const notAfter = new Date(now + req.validDays * 24 * 60 * 60 * 1000);
        cert.validity.notAfter = notAfter > ca.cert.validity.notAfter ? ca.cert.validity.notAfter : notAfter;

        const subject: forge.pki.CertificateField[] = [
            { name: 'commonName', value: utf8Value(req.commonName) },
            { name: 'organizationalUnitName', value: utf8Value(req.organizationalUnit || 'Cardiology') },
            { name: 'organizationName', value: utf8Value(this.orgName()) },
            { name: 'countryName', value: 'VN' },
        ];
        if (req.serialNumberAttr) subject.push({ name: 'serialNumber', value: utf8Value(req.serialNumberAttr) });
        cert.setSubject(subject);
        cert.setIssuer(ca.cert.subject.attributes);

        const extensions: any[] = [
            { name: 'basicConstraints', cA: false, critical: true },
            { name: 'keyUsage', digitalSignature: true, nonRepudiation: true, critical: true },
            { name: 'extKeyUsage', emailProtection: true },
            { name: 'subjectKeyIdentifier' },
        ];
        if (req.email) extensions.push({ name: 'subjectAltName', altNames: [{ type: 1, value: req.email }] });
        cert.setExtensions(extensions);
        cert.sign(ca.privateKey, forge.md.sha256.create());

        return { cert, authority: ca.authority };
    }

    /** Toàn bộ chứng thư CA được tin cậy (root nội bộ — kể cả đã retired để xác minh chữ ký cũ — và CA ngoài). */
    async getTrustedCertificates(): Promise<forge.pki.Certificate[]> {
        await this.getOrCreateRootCa();
        const rows = await this.prisma.pkiAuthority.findMany();
        return rows.flatMap((r) => parseCertificatesPem(r.certPem));
    }

    async getTrustStore(): Promise<forge.pki.CAStore> {
        return forge.pki.createCaStore(await this.getTrustedCertificates());
    }

    async listAuthorities() {
        await this.getOrCreateRootCa();
        const rows = await this.prisma.pkiAuthority.findMany({ orderBy: { createdAt: 'asc' } });
        // KHÔNG trả encryptedPrivateKey.
        return rows.map(({ encryptedPrivateKey, ...pub }) => ({ ...pub, hasPrivateKey: !!encryptedPrivateKey }));
    }

    /** Thêm Root/Intermediate CA bên ngoài (vd. CA công cộng được cấp phép) làm trust anchor để xác minh chữ ký. */
    async addTrustedExternal(certPem: string) {
        let certs: forge.pki.Certificate[];
        try {
            certs = parseCertificatesPem(certPem);
        } catch {
            throw new BadRequestException('Không đọc được chứng thư — cần PEM hợp lệ (-----BEGIN CERTIFICATE-----).');
        }
        if (certs.length !== 1) throw new BadRequestException('Mỗi lần chỉ thêm đúng 1 chứng thư CA.');

        const [cert] = certs;
        const bc = cert.getExtension('basicConstraints') as { cA?: boolean } | null;
        if (!bc?.cA) throw new BadRequestException('Chứng thư này không phải CA (basicConstraints.cA = false).');
        if (cert.validity.notAfter < new Date()) throw new BadRequestException('Chứng thư CA đã hết hạn.');

        const fingerprintSha256 = certFingerprintSha256(cert);
        if (await this.prisma.pkiAuthority.findUnique({ where: { fingerprintSha256 } })) {
            throw new ConflictException('CA này đã có trong danh sách tin cậy.');
        }
        const created = await this.prisma.pkiAuthority.create({
            data: {
                kind: AUTHORITY_KIND.TRUSTED_EXTERNAL,
                subjectDn: dnToString(cert.subject.attributes),
                serialNumber: cert.serialNumber,
                fingerprintSha256,
                certPem: certsToPem([cert]),
                notBefore: cert.validity.notBefore,
                notAfter: cert.validity.notAfter,
            },
        });
        const { encryptedPrivateKey, ...pub } = created;
        return pub;
    }

    async getRootCaPublic() {
        const { authority } = await this.getOrCreateRootCa();
        const { encryptedPrivateKey, ...pub } = authority;
        return pub;
    }
}
