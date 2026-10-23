import { PDFDocument } from 'pdf-lib';
import { pdflibAddPlaceholder } from '@signpdf/placeholder-pdf-lib';
import * as forge from 'node-forge';
import { PkiKeyVaultService } from './pki-key-vault.service';
import { PkiAuthorityService } from './pki-authority.service';
import { DoctorCertificateService } from './doctor-certificate.service';
import { PdfSignatureService } from './pdf-signature.service';
import { PdfSigner } from './pki.types';
import { generateRsaKeyPair, randomSerialHex, toForgePrivateKey, certFingerprintSha256 } from './pki-x509.util';

/** Prisma giả tối thiểu (in-memory) cho các bảng PKI. */
function makeFakePrisma() {
    const authorities: any[] = [];
    const certs: any[] = [];
    const doctors = [
        { doctorId: 'd1', userId: 'u1', doctorCode: 'BS001', fullName: 'Nguyễn Văn Tâm', specialization: 'echocardiography', licenseNumber: 'CCHN-12345', isActive: true, user: { email: 'tam@clinic.vn' } },
    ];
    const match = (row: any, where: any) =>
        Object.entries(where ?? {}).every(([k, v]: [string, any]) => {
            if (v && typeof v === 'object' && !(v instanceof Date)) {
                if ('lte' in v) return row[k] <= v.lte;
                if ('gte' in v) return row[k] >= v.gte;
                return true;
            }
            return row[k] === v;
        });
    const table = (rows: any[], idKey: string) => ({
        findFirst: async ({ where }: any = {}) => rows.filter((r) => match(r, where)).slice(-1)[0] ?? null,
        findUnique: async ({ where }: any) => rows.find((r) => match(r, where)) ?? null,
        findMany: async ({ where }: any = {}) => rows.filter((r) => match(r, where)),
        create: async ({ data }: any) => {
            const row = { [idKey]: `id-${rows.length + 1}`, status: 'active', createdAt: new Date(), revokedAt: null, chainPem: null, ...data };
            rows.push(row);
            return row;
        },
        update: async ({ where, data }: any) => Object.assign(rows.find((r) => match(r, where)), data),
    });
    const prisma: any = {
        pkiAuthority: table(authorities, 'authorityId'),
        doctorCertificate: table(certs, 'certificateId'),
        doctor: { findUnique: async ({ where }: any) => doctors.find((d) => d.doctorId === where.doctorId) ?? null },
        $executeRaw: async () => 0,
        $transaction: async (fn: any) => fn(prisma),
    };
    return { prisma, doctors, certs, authorities };
}

async function buildSignedPdf(signer: PdfSigner, text = 'DON THUOC TEST'): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.addPage([595, 842]).drawText(text, { x: 50, y: 800 });
    pdflibAddPlaceholder({
        pdfDoc, reason: signer.reason, contactInfo: signer.contactInfo, name: signer.name,
        location: signer.location, signatureLength: signer.signatureLength,
    });
    return signer.sign(Buffer.from(await pdfDoc.save({ useObjectStreams: false })));
}

describe('PKI / CA — ký và xác minh PDF đơn thuốc', () => {
    jest.setTimeout(60000);
    process.env.PKI_MASTER_KEY = '11'.repeat(32);
    process.env.PKI_ROOT_CA_BITS = '2048'; // test chạy nhanh

    let fake: ReturnType<typeof makeFakePrisma>;
    let authority: PkiAuthorityService;
    let certService: DoctorCertificateService;
    let pdfSig: PdfSignatureService;
    const signedAt = new Date();

    beforeEach(() => {
        fake = makeFakePrisma();
        const vault = new PkiKeyVaultService();
        authority = new PkiAuthorityService(fake.prisma, vault);
        certService = new DoctorCertificateService(fake.prisma, authority, vault);
        pdfSig = new PdfSignatureService(certService, authority);
    });

    const signWith = async (certRecord: any, text?: string) =>
        buildSignedPdf(pdfSig.createSigner(certRecord, { signerName: 'Nguyễn Văn Tâm', reason: 'Ky don', location: 'Clinic', signingTime: signedAt }), text);

    it('vault: mã hoá/giải mã AES-GCM và phát hiện bị sửa', () => {
        const v = new PkiKeyVaultService();
        const blob = v.encrypt('secret-key');
        expect(blob).not.toContain('secret-key');
        expect(v.decrypt(blob)).toBe('secret-key');
        const tampered = blob.slice(0, -2) + (blob.endsWith('AA') ? 'BB' : 'AA');
        expect(() => v.decrypt(tampered)).toThrow();
    });

    it('tạo Root CA một lần và cấp chứng thư bác sĩ (X.509, SHA-256, keyUsage ký số)', async () => {
        const ca1 = await authority.getOrCreateRootCa();
        const cert = await certService.issueForDoctor('d1', 'admin');
        expect(fake.authorities).toHaveLength(1);
        const leaf = forge.pki.certificateFromPem(cert.certPem);
        expect(leaf.signatureOid).toBe(forge.pki.oids.sha256WithRSAEncryption);
        expect(ca1.cert.verify(leaf)).toBe(true);
        expect((leaf.getExtension('keyUsage') as any).nonRepudiation).toBe(true);
        expect((leaf.getExtension('basicConstraints') as any).cA).toBe(false);
        expect(forge.util.decodeUtf8(leaf.subject.getField('CN').value)).toBe('Nguyễn Văn Tâm');
        expect(cert.subjectDn).toContain('CN=Nguyễn Văn Tâm');
        expect(cert.encryptedPrivateKey).not.toContain('PRIVATE KEY');
        await expect(certService.issueForDoctor('d1')).rejects.toThrow(/đã có chứng thư/);
    });

    it('ký → xác minh hợp lệ; sửa 1 byte nội dung → không hợp lệ', async () => {
        const cert = await certService.issueForDoctor('d1');
        const pdf = await signWith(cert);
        const ok = await pdfSig.verifyPdf(pdf, { signedAt });
        expect(ok.checks.filter((c) => !c.ok)).toEqual([]);
        expect(ok.valid).toBe(true);
        expect(ok.signer?.fingerprintSha256).toBe(cert.fingerprintSha256);

        const tampered = Buffer.from(pdf);
        const pos = tampered.indexOf('/Type /Page');
        tampered[pos + 1] = tampered[pos + 1] === 0x54 ? 0x55 : 0x54; // đổi 1 byte trong vùng được ký
        const bad = await pdfSig.verifyPdf(tampered, { signedAt });
        expect(bad.valid).toBe(false);
        expect(bad.checks.find((c) => c.code === 'digest_match')?.ok).toBe(false);
    });

    it('nối thêm nội dung sau khi ký (incremental update) bị phát hiện', async () => {
        const cert = await certService.issueForDoctor('d1');
        const pdf = Buffer.concat([await signWith(cert), Buffer.from('\n% appended\n')]);
        const res = await pdfSig.verifyPdf(pdf, { signedAt });
        expect(res.valid).toBe(false);
        expect(res.checks.find((c) => c.code === 'byte_range')?.ok).toBe(false);
    });

    it('thu hồi SAU khi ký: chữ ký vẫn hợp lệ nhưng ghi nhận revokedAfterSigning; thu hồi TRƯỚC khi ký: không hợp lệ', async () => {
        const cert = await certService.issueForDoctor('d1');
        const pdf = await signWith(cert);
        await certService.revoke(cert.certificateId, 'test', 'admin'); // revokedAt = now > signedAt
        const after = await pdfSig.verifyPdf(pdf, { signedAt });
        expect(after.valid).toBe(true);
        expect(after.certificateStatus).toBe('revoked');
        expect(after.revokedAfterSigning).toBe(true);

        const before = await pdfSig.verifyPdf(pdf, { signedAt: new Date(Date.now() + 60_000) });
        expect(before.valid).toBe(false);
        expect(before.checks.find((c) => c.code === 'revocation')?.ok).toBe(false);
    });

    it('chứng thư của CA lạ (không nằm trong trust store) bị từ chối', async () => {
        // CA nội bộ #1 cấp chứng thư và ký PDF
        const cert = await certService.issueForDoctor('d1');
        const pdf = await signWith(cert);
        // Hệ thống #2 (DB khác, Root CA khác) xác minh cùng file
        const other = makeFakePrisma();
        const vault = new PkiKeyVaultService();
        const auth2 = new PkiAuthorityService(other.prisma, vault);
        const certs2 = new DoctorCertificateService(other.prisma, auth2, vault);
        const verifier2 = new PdfSignatureService(certs2, auth2);
        const res = await verifier2.verifyPdf(pdf, { signedAt });
        expect(res.valid).toBe(false);
        expect(res.checks.find((c) => c.code === 'chain_trusted')?.ok).toBe(false);
        expect(res.checks.find((c) => c.code === 'certificate_registered')?.ok).toBe(false);
    });

    it('import .p12 từ CA ngoài: cần trust anchor trước; sau đó ký/xác minh được', async () => {
        // Dựng 1 "CA công cộng" bên ngoài bằng forge
        const caKeys = await generateRsaKeyPair(2048);
        const caCert = forge.pki.createCertificate();
        caCert.publicKey = forge.pki.publicKeyFromPem(caKeys.publicKeyPem);
        caCert.serialNumber = randomSerialHex();
        caCert.validity.notBefore = new Date(Date.now() - 86400000);
        caCert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
        const caAttrs = [{ name: 'commonName', value: 'Public Test CA' }, { name: 'countryName', value: 'VN' }];
        caCert.setSubject(caAttrs); caCert.setIssuer(caAttrs);
        caCert.setExtensions([{ name: 'basicConstraints', cA: true, critical: true }, { name: 'keyUsage', keyCertSign: true, critical: true }]);
        caCert.sign(toForgePrivateKey(caKeys.privateKeyPem), forge.md.sha256.create());

        const docKeys = await generateRsaKeyPair(2048);
        const docCert = forge.pki.createCertificate();
        docCert.publicKey = forge.pki.publicKeyFromPem(docKeys.publicKeyPem);
        docCert.serialNumber = randomSerialHex();
        docCert.validity.notBefore = new Date(Date.now() - 3600000);
        docCert.validity.notAfter = new Date(Date.now() + 200 * 86400000);
        docCert.setSubject([{ name: 'commonName', value: 'BS Ngoai CA' }]);
        docCert.setIssuer(caAttrs);
        docCert.setExtensions([{ name: 'basicConstraints', cA: false }, { name: 'keyUsage', digitalSignature: true, nonRepudiation: true }]);
        docCert.sign(toForgePrivateKey(caKeys.privateKeyPem), forge.md.sha256.create());
        const p12 = Buffer.from(
            forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(toForgePrivateKey(docKeys.privateKeyPem), [docCert], 'pw123', { algorithm: '3des' })).getBytes(),
            'binary',
        );

        await expect(certService.importPkcs12('d1', p12, 'pw123')).rejects.toThrow(/không xác minh được tới CA tin cậy/);
        await expect(certService.importPkcs12('d1', p12, 'sai-mat-khau')).rejects.toThrow(/Không đọc được file \.p12/);

        await authority.addTrustedExternal(forge.pki.certificateToPem(caCert));
        const imported = await certService.importPkcs12('d1', p12, 'pw123', 'admin');
        expect(imported.source).toBe('imported');
        expect(imported.fingerprintSha256).toBe(certFingerprintSha256(docCert));

        const pdf = await signWith(imported);
        const res = await pdfSig.verifyPdf(pdf, { signedAt });
        expect(res.checks.filter((c) => !c.ok)).toEqual([]);
        await expect(authority.addTrustedExternal(forge.pki.certificateToPem(docCert))).rejects.toThrow(/không phải CA/);
    });

    it('PKI_AUTO_ISSUE=false: không tự cấp khi ký', async () => {
        process.env.PKI_AUTO_ISSUE = 'false';
        await expect(certService.getOrIssueForSigning(fake.doctors[0] as any)).rejects.toThrow(/chưa có chứng thư số/);
        delete process.env.PKI_AUTO_ISSUE;
        const auto = await certService.getOrIssueForSigning(fake.doctors[0] as any);
        expect(auto.source).toBe('internal_ca');
    });
});
