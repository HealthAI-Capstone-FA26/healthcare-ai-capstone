import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as forge from 'node-forge';
import { randomBytes } from 'crypto';
import { Doctor, DoctorCertificate } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { PkiAuthorityService } from './pki-authority.service';
import { PkiKeyVaultService } from './pki-key-vault.service';
import { PKI_SOURCE } from './pki.types';
import {
    certFingerprintSha256,
    certsToPem,
    dnToString,
    generateRsaKeyPair,
    parseCertificatesPem,
    toForgePrivateKey,
} from './pki-x509.util';

const DOCTOR_KEY_BITS = 2048;

export interface SigningMaterial {
    p12: Buffer;
    passphrase: string;
    certificate: forge.pki.Certificate;
}

/** Bỏ các trường nhạy cảm trước khi trả ra API. */
export function toPublicCertificate(c: DoctorCertificate) {
    const { encryptedPrivateKey, ...pub } = c;
    return { ...pub, effectiveStatus: effectiveStatus(c) };
}

export function effectiveStatus(c: Pick<DoctorCertificate, 'status' | 'notBefore' | 'notAfter'>, at = new Date()) {
    if (c.status === 'revoked') return 'revoked';
    if (at < c.notBefore) return 'not_yet_valid';
    if (at > c.notAfter) return 'expired';
    return 'active';
}

@Injectable()
export class DoctorCertificateService {
    private readonly logger = new Logger(DoctorCertificateService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly authorities: PkiAuthorityService,
        private readonly vault: PkiKeyVaultService,
    ) {}

    private validDays(): number {
        const n = Number(process.env.PKI_DOCTOR_CERT_VALID_DAYS);
        return Number.isFinite(n) && n > 0 ? n : 730;
    }

    /** PKI_AUTO_ISSUE (mặc định true): tự cấp chứng thư nội bộ ở lần ký đầu tiên. Production nên tắt và cấp có kiểm soát. */
    private autoIssueEnabled(): boolean {
        return (process.env.PKI_AUTO_ISSUE ?? 'true').toLowerCase() !== 'false';
    }

    async findUsableCertificate(doctorId: string): Promise<DoctorCertificate | null> {
        const now = new Date();
        return this.prisma.doctorCertificate.findFirst({
            where: { doctorId, status: 'active', notBefore: { lte: now }, notAfter: { gte: now } },
            orderBy: { createdAt: 'desc' },
        });
    }

    /** Dùng khi ký đơn: lấy chứng thư còn hiệu lực của bác sĩ; chưa có thì tự cấp (nếu được bật) hoặc báo lỗi rõ ràng. */
    async getOrIssueForSigning(doctor: Doctor): Promise<DoctorCertificate> {
        const usable = await this.findUsableCertificate(doctor.doctorId);
        if (usable) return usable;
        if (!this.autoIssueEnabled()) {
            throw new ForbiddenException(
                'Bác sĩ chưa có chứng thư số còn hiệu lực. Liên hệ quản trị viên để cấp chứng thư (POST /pki/doctors/:doctorId/certificates) hoặc import .p12 từ CA.',
            );
        }
        this.logger.log(`Tự cấp chứng thư số cho bác sĩ ${doctor.doctorCode} (PKI_AUTO_ISSUE).`);
        return this.issueForDoctor(doctor.doctorId, doctor.userId);
    }

    /** Cấp chứng thư mới từ CA nội bộ: sinh cặp khoá RSA-2048, Root CA ký, private key mã hoá rồi lưu. */
    async issueForDoctor(doctorId: string, issuedByUserId?: string) {
        const doctor = await this.prisma.doctor.findUnique({ where: { doctorId }, include: { user: { select: { email: true } } } });
        if (!doctor) throw new NotFoundException('Không tìm thấy bác sĩ');
        if (!doctor.isActive) throw new BadRequestException('Bác sĩ đang bị vô hiệu hoá, không thể cấp chứng thư.');
        if (await this.findUsableCertificate(doctorId)) {
            throw new ConflictException('Bác sĩ đã có chứng thư còn hiệu lực — hãy thu hồi (revoke) trước khi cấp mới.');
        }

        const { privateKeyPem, publicKeyPem } = await generateRsaKeyPair(DOCTOR_KEY_BITS);
        const { cert, authority } = await this.authorities.issueLeafCertificate({
            publicKeyPem,
            commonName: doctor.fullName,
            organizationalUnit: doctor.specialization ?? undefined,
            serialNumberAttr: doctor.licenseNumber ?? undefined,
            email: doctor.user?.email,
            validDays: this.validDays(),
        });

        return this.prisma.doctorCertificate.create({
            data: {
                doctorId,
                authorityId: authority.authorityId,
                source: PKI_SOURCE.INTERNAL_CA,
                serialNumber: cert.serialNumber,
                subjectDn: dnToString(cert.subject.attributes),
                issuerDn: dnToString(cert.issuer.attributes),
                fingerprintSha256: certFingerprintSha256(cert),
                certPem: forge.pki.certificateToPem(cert),
                encryptedPrivateKey: this.vault.encrypt(privateKeyPem),
                notBefore: cert.validity.notBefore,
                notAfter: cert.validity.notAfter,
                issuedByUserId: issuedByUserId ?? null,
            },
        });
    }

    /**
     * Import chứng thư + private key từ file PKCS#12 do CA công cộng được cấp phép phát hành.
     * Chuỗi chứng thư PHẢI xác minh được tới một CA đã nằm trong danh sách tin cậy (POST /pki/authorities/trust).
     */
    async importPkcs12(doctorId: string, p12: Buffer, passphrase: string, issuedByUserId?: string) {
        const doctor = await this.prisma.doctor.findUnique({ where: { doctorId } });
        if (!doctor) throw new NotFoundException('Không tìm thấy bác sĩ');

        let bagKey: forge.pki.rsa.PrivateKey | undefined;
        let certs: forge.pki.Certificate[] = [];
        try {
            const asn1 = forge.asn1.fromDer(forge.util.createBuffer(p12.toString('binary')));
            const p12Obj = forge.pkcs12.pkcs12FromAsn1(asn1, false, passphrase);
            const oids = forge.pki.oids;
            const keyBags = [
                ...(p12Obj.getBags({ bagType: oids.pkcs8ShroudedKeyBag })[oids.pkcs8ShroudedKeyBag] ?? []),
                ...(p12Obj.getBags({ bagType: oids.keyBag })[oids.keyBag] ?? []),
            ];
            bagKey = keyBags[0]?.key as forge.pki.rsa.PrivateKey | undefined;
            certs = (p12Obj.getBags({ bagType: oids.certBag })[oids.certBag] ?? []).map((b) => b.cert!).filter(Boolean);
        } catch {
            throw new BadRequestException('Không đọc được file .p12 (sai mật khẩu hoặc file hỏng).');
        }
        if (!bagKey || certs.length === 0) throw new BadRequestException('File .p12 phải chứa cả private key và chứng thư.');

        const leaf = certs.find((c) => {
            const pk = c.publicKey as forge.pki.rsa.PublicKey;
            return pk.n.compareTo(bagKey!.n) === 0 && pk.e.compareTo(bagKey!.e) === 0;
        });
        if (!leaf) throw new BadRequestException('Không có chứng thư nào khớp với private key trong file .p12.');
        const chain = certs.filter((c) => c !== leaf);

        const now = new Date();
        if (leaf.validity.notBefore > now || leaf.validity.notAfter < now) {
            throw new BadRequestException('Chứng thư trong file .p12 chưa hiệu lực hoặc đã hết hạn.');
        }
        const ku = leaf.getExtension('keyUsage') as { digitalSignature?: boolean; nonRepudiation?: boolean } | null;
        if (ku && !ku.digitalSignature && !ku.nonRepudiation) {
            throw new BadRequestException('Chứng thư không có quyền ký số (keyUsage thiếu digitalSignature/nonRepudiation).');
        }

        try {
            forge.pki.verifyCertificateChain(await this.authorities.getTrustStore(), [leaf, ...chain]);
        } catch (e: any) {
            throw new BadRequestException(
                `Chuỗi chứng thư không xác minh được tới CA tin cậy (${e?.message ?? 'unknown'}). Hãy thêm CA gốc/trung gian vào danh sách tin cậy trước.`,
            );
        }

        const fingerprintSha256 = certFingerprintSha256(leaf);
        if (await this.prisma.doctorCertificate.findUnique({ where: { fingerprintSha256 } })) {
            throw new ConflictException('Chứng thư này đã được import.');
        }
        if (await this.findUsableCertificate(doctorId)) {
            throw new ConflictException('Bác sĩ đã có chứng thư còn hiệu lực — hãy thu hồi (revoke) trước khi import chứng thư mới.');
        }

        const pkcs8Pem = forge.pki.privateKeyInfoToPem(forge.pki.wrapRsaPrivateKey(forge.pki.privateKeyToAsn1(bagKey)));
        return this.prisma.doctorCertificate.create({
            data: {
                doctorId,
                authorityId: null,
                source: PKI_SOURCE.IMPORTED,
                serialNumber: leaf.serialNumber,
                subjectDn: dnToString(leaf.subject.attributes),
                issuerDn: dnToString(leaf.issuer.attributes),
                fingerprintSha256,
                certPem: forge.pki.certificateToPem(leaf),
                chainPem: chain.length ? certsToPem(chain) : null,
                encryptedPrivateKey: this.vault.encrypt(pkcs8Pem),
                notBefore: leaf.validity.notBefore,
                notAfter: leaf.validity.notAfter,
                issuedByUserId: issuedByUserId ?? null,
            },
        });
    }

    async revoke(certificateId: string, reason: string, revokedByUserId?: string) {
        const cert = await this.prisma.doctorCertificate.findUnique({ where: { certificateId } });
        if (!cert) throw new NotFoundException('Không tìm thấy chứng thư');
        if (cert.status === 'revoked') throw new ConflictException('Chứng thư đã bị thu hồi trước đó.');
        const updated = await this.prisma.doctorCertificate.update({
            where: { certificateId },
            data: { status: 'revoked', revokedAt: new Date(), revokeReason: reason, revokedByUserId: revokedByUserId ?? null },
        });
        this.logger.warn(`Đã thu hồi chứng thư ${updated.serialNumber} (bác sĩ ${updated.doctorId}): ${reason}`);
        return toPublicCertificate(updated);
    }

    async list(doctorId?: string) {
        const rows = await this.prisma.doctorCertificate.findMany({
            where: doctorId ? { doctorId } : {},
            orderBy: { createdAt: 'desc' },
        });
        return rows.map(toPublicCertificate);
    }

    /** Danh sách thu hồi (CRL dạng JSON) — dùng để đối soát chữ ký đã phát hành. */
    async revocationList() {
        const rows = await this.prisma.doctorCertificate.findMany({
            where: { status: 'revoked' },
            select: { serialNumber: true, fingerprintSha256: true, subjectDn: true, revokedAt: true, revokeReason: true },
            orderBy: { revokedAt: 'desc' },
        });
        return { generatedAt: new Date().toISOString(), revoked: rows };
    }

    /** Dựng PKCS#12 trong bộ nhớ (passphrase ngẫu nhiên, dùng 1 lần) để đưa cho bộ ký PDF. Private key không rời tiến trình. */
    buildSigningMaterial(record: DoctorCertificate): SigningMaterial {
        const privateKey = toForgePrivateKey(this.vault.decrypt(record.encryptedPrivateKey));
        const [leaf] = parseCertificatesPem(record.certPem);
        const chain = record.chainPem ? parseCertificatesPem(record.chainPem) : [];
        const passphrase = randomBytes(24).toString('hex');
        const p12Asn1 = forge.pkcs12.toPkcs12Asn1(privateKey, [leaf, ...chain], passphrase, { algorithm: '3des', generateLocalKeyId: true });
        const p12 = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
        return { p12, passphrase, certificate: leaf };
    }

    async findByFingerprint(fingerprintSha256: string) {
        return this.prisma.doctorCertificate.findUnique({ where: { fingerprintSha256 } });
    }

    async findById(certificateId: string) {
        return this.prisma.doctorCertificate.findUnique({ where: { certificateId } });
    }
}
