import { Injectable } from '@nestjs/common';
import * as forge from 'node-forge';
import { DoctorCertificate } from '@prisma/client';
import { SignPdf } from '@signpdf/signpdf';
import { P12Signer } from '@signpdf/signer-p12';
import { DoctorCertificateService } from './doctor-certificate.service';
import { PkiAuthorityService } from './pki-authority.service';
import { PdfSignatureCheck, PdfSignatureVerification, PdfSigner } from './pki.types';
import { asciiFold, certFingerprintSha256, dnToString, sameSerial } from './pki-x509.util';

/** Đủ chỗ cho CMS gồm chứng thư bác sĩ + chuỗi CA (RSA-2048/4096). */
const SIGNATURE_LENGTH = 16384;
const OID_MESSAGE_DIGEST = '1.2.840.113549.1.9.4';
const OID_SIGNING_TIME = '1.2.840.113549.1.9.5';

/**
 * Ký / xác minh PDF theo chuẩn PAdES cơ bản (adbe.pkcs7.detached, SHA-256, RSA PKCS#1 v1.5).
 *
 * Ký:  module nghiệp vụ dựng PDF + placeholder (xem PdfSigner) → createSigner().sign() nhúng chữ ký CMS.
 * Xác minh (verifyPdf) — các kiểm tra độc lập, mỗi kiểm tra trả 1 PdfSignatureCheck:
 *   byte_range (chữ ký phủ toàn bộ file, không có nội dung nối thêm) · cms_parse · digest_algorithm · digest_match
 *   · signature_valid · chain_trusted (tại thời điểm ký) · key_usage · certificate_registered/revocation
 */
@Injectable()
export class PdfSignatureService {
    constructor(
        private readonly certificates: DoctorCertificateService,
        private readonly authorities: PkiAuthorityService,
    ) {}

    createSigner(record: DoctorCertificate, opts: { signerName: string; reason: string; location: string; signingTime: Date }): PdfSigner {
        const { p12, passphrase } = this.certificates.buildSigningMaterial(record);
        return {
            name: asciiFold(opts.signerName),
            reason: asciiFold(opts.reason),
            location: asciiFold(opts.location),
            contactInfo: asciiFold(record.subjectDn.match(/E=([^,]+)/)?.[1] ?? opts.signerName),
            signatureLength: SIGNATURE_LENGTH,
            sign: async (pdf: Buffer) => {
                const signer = new P12Signer(p12, { passphrase });
                return new SignPdf().sign(pdf, signer, opts.signingTime);
            },
        };
    }

    /** `signedAt` = mốc ký tin cậy (lấy từ DB), dùng để kiểm tra hiệu lực chứng thư và thời điểm thu hồi. */
    async verifyPdf(pdf: Buffer, ctx: { signedAt: Date }): Promise<PdfSignatureVerification> {
        const checks: PdfSignatureCheck[] = [];
        const add = (code: string, ok: boolean, message: string) => checks.push({ code, ok, message });
        const finish = (extra: Partial<PdfSignatureVerification> = {}): PdfSignatureVerification => ({
            valid: checks.every((c) => c.ok),
            checks,
            ...extra,
        });

        // 1. ByteRange phải phủ toàn bộ file (chống nối thêm nội dung sau khi ký / incremental update)
        const extracted = this.extractSignature(pdf);
        if (!extracted.ok) {
            add('byte_range', false, extracted.error);
            return finish();
        }
        const { byteRange, cmsDer, signedData } = extracted;
        const coversAll = byteRange[0] === 0 && byteRange[2] + byteRange[3] === pdf.length;
        add('byte_range', coversAll, coversAll ? 'Chữ ký bao phủ toàn bộ nội dung file.' : 'Chữ ký KHÔNG bao phủ toàn bộ file — có nội dung được thêm sau khi ký.');

        // 2. Parse CMS / PKCS#7
        let p7: any;
        try {
            p7 = forge.pkcs7.messageFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(cmsDer.toString('binary'))));
            if (p7.type !== forge.pki.oids.signedData || !p7.rawCapture?.signature) throw new Error('không phải SignedData');
            add('cms_parse', true, 'Đọc được cấu trúc chữ ký CMS/PKCS#7.');
        } catch (e: any) {
            add('cms_parse', false, `Không đọc được chữ ký CMS: ${e?.message ?? 'lỗi không xác định'}`);
            return finish();
        }

        const raw = p7.rawCapture;
        const certs: forge.pki.Certificate[] = p7.certificates ?? [];
        const serialHex = forge.util.createBuffer(raw.serial).toHex();
        const leaf = certs.find((c) => sameSerial(c.serialNumber, serialHex));
        if (!leaf) {
            add('cms_parse', false, 'Chữ ký không đính kèm chứng thư của người ký.');
            return finish();
        }
        const fingerprint = certFingerprintSha256(leaf);
        const signer = {
            subject: dnToString(leaf.subject.attributes),
            issuer: dnToString(leaf.issuer.attributes),
            serialNumber: leaf.serialNumber,
            fingerprintSha256: fingerprint,
            notBefore: leaf.validity.notBefore.toISOString(),
            notAfter: leaf.validity.notAfter.toISOString(),
        };

        // 3. Chỉ chấp nhận SHA-256
        const digestOid = forge.asn1.derToOid(raw.digestAlgorithm);
        const sha256 = digestOid === forge.pki.oids.sha256;
        add('digest_algorithm', sha256, sha256 ? 'Thuật toán băm SHA-256.' : `Thuật toán băm không được chấp nhận (${digestOid}).`);

        // 4. messageDigest trong chữ ký phải bằng SHA-256 của nội dung đã ký
        const attrs: any[] = raw.authenticatedAttributes ?? [];
        let cmsSigningTime: string | undefined;
        let messageDigest: string | undefined;
        for (const attr of attrs) {
            const oid = forge.asn1.derToOid(attr.value[0].value);
            const valueNode = attr.value[1].value[0];
            if (oid === OID_MESSAGE_DIGEST) messageDigest = valueNode.value as string;
            if (oid === OID_SIGNING_TIME) {
                const t = valueNode.type === forge.asn1.Type.UTCTIME ? forge.asn1.utcTimeToDate(valueNode.value) : forge.asn1.generalizedTimeToDate(valueNode.value);
                cmsSigningTime = t.toISOString();
            }
        }
        const actualDigest = forge.md.sha256.create().update(signedData.toString('binary')).digest().getBytes();
        const digestOk = !!messageDigest && messageDigest === actualDigest;
        add('digest_match', digestOk, digestOk ? 'Nội dung PDF khớp giá trị băm đã ký — chưa bị chỉnh sửa.' : 'Nội dung PDF KHÔNG khớp giá trị băm đã ký — tài liệu đã bị sửa hoặc chữ ký hỏng.');

        // 5. Chữ ký RSA trên authenticatedAttributes (DER dạng SET)
        let sigOk = false;
        try {
            const set = forge.asn1.create(forge.asn1.Class.UNIVERSAL, forge.asn1.Type.SET, true, attrs);
            const md = forge.md.sha256.create();
            md.update(forge.asn1.toDer(set).getBytes());
            sigOk = (leaf.publicKey as forge.pki.rsa.PublicKey).verify(md.digest().getBytes(), raw.signature);
        } catch {
            sigOk = false;
        }
        add('signature_valid', sigOk, sigOk ? 'Chữ ký số hợp lệ với khoá công khai trong chứng thư.' : 'Chữ ký số KHÔNG hợp lệ.');

        // 6. Chuỗi tin cậy tại thời điểm ký
        try {
            forge.pki.verifyCertificateChain(
                await this.authorities.getTrustStore(),
                [leaf, ...certs.filter((c) => c !== leaf)],
                { validityCheckDate: ctx.signedAt } as any,
            );
            add('chain_trusted', true, 'Chứng thư của người ký do CA tin cậy cấp và còn hiệu lực tại thời điểm ký.');
        } catch (e: any) {
            add('chain_trusted', false, `Chuỗi chứng thư không đáng tin: ${e?.message ?? 'lỗi không xác định'}`);
        }

        // 7. Mục đích sử dụng khoá
        const ku = leaf.getExtension('keyUsage') as { digitalSignature?: boolean; nonRepudiation?: boolean } | null;
        const kuOk = !ku || !!ku.digitalSignature || !!ku.nonRepudiation;
        add('key_usage', kuOk, kuOk ? 'Chứng thư được phép dùng để ký số.' : 'Chứng thư không có quyền ký số (keyUsage).');

        // 8. Chứng thư có trong sổ của hệ thống và tình trạng thu hồi so với thời điểm ký
        const record = await this.certificates.findByFingerprint(fingerprint);
        let certificateStatus: PdfSignatureVerification['certificateStatus'] = 'unknown';
        let revokedAt: string | undefined;
        let revokedAfterSigning: boolean | undefined;
        if (!record) {
            add('certificate_registered', false, 'Chứng thư không có trong sổ chứng thư của hệ thống (chưa từng được cấp/import).');
        } else {
            add('certificate_registered', true, 'Chứng thư có trong sổ chứng thư của hệ thống.');
            certificateStatus = record.status === 'revoked' ? 'revoked' : 'active';
            if (record.status === 'revoked' && record.revokedAt) {
                revokedAt = record.revokedAt.toISOString();
                revokedAfterSigning = record.revokedAt > ctx.signedAt;
                add(
                    'revocation',
                    revokedAfterSigning,
                    revokedAfterSigning
                        ? 'Chứng thư bị thu hồi SAU thời điểm ký — chữ ký vẫn hợp lệ tại thời điểm ký.'
                        : 'Chứng thư đã bị thu hồi TRƯỚC thời điểm ký — chữ ký không đáng tin.',
                );
            } else {
                add('revocation', true, 'Chứng thư chưa bị thu hồi.');
            }
        }

        return finish({ signer, cmsSigningTime, certificateStatus, revokedAt, revokedAfterSigning });
    }

    /** Đọc /ByteRange và vùng /Contents. Chỉ chấp nhận đúng 1 chữ ký trong file. */
    private extractSignature(
        pdf: Buffer,
    ): { ok: true; byteRange: number[]; cmsDer: Buffer; signedData: Buffer } | { ok: false; error: string } {
        const text = pdf.toString('latin1');
        const occurrences = text.split('/ByteRange').length - 1;
        if (occurrences === 0) return { ok: false, error: 'PDF không chứa chữ ký số.' };
        if (occurrences > 1) return { ok: false, error: 'PDF chứa nhiều hơn một chữ ký — không được hỗ trợ.' };

        const m = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
        if (!m) return { ok: false, error: 'Không đọc được /ByteRange.' };
        const byteRange = m.slice(1, 5).map(Number);
        const [a, b, c, d] = byteRange;
        if (a < 0 || a + b > c || c + d > pdf.length) return { ok: false, error: '/ByteRange không hợp lệ.' };

        const hexRegion = pdf.subarray(a + b, c).toString('latin1');
        if (!hexRegion.startsWith('<') || !hexRegion.endsWith('>')) return { ok: false, error: 'Vùng /Contents không đúng định dạng.' };
        const bytes = Buffer.from(hexRegion.slice(1, -1), 'hex');

        // Cắt đúng độ dài DER (bỏ phần đệm 00 của placeholder)
        if (bytes.length < 4 || bytes[0] !== 0x30) return { ok: false, error: 'Vùng /Contents không chứa CMS DER hợp lệ.' };
        let total: number;
        if (bytes[1] < 0x80) total = 2 + bytes[1];
        else {
            const n = bytes[1] & 0x7f;
            let len = 0;
            for (let i = 0; i < n; i++) len = len * 256 + bytes[2 + i];
            total = 2 + n + len;
        }
        if (total > bytes.length) return { ok: false, error: 'CMS DER bị cắt cụt.' };

        return {
            ok: true,
            byteRange,
            cmsDer: bytes.subarray(0, total),
            signedData: Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + d)]),
        };
    }
}
