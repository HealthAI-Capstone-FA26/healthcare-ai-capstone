import { createHash, generateKeyPair, randomBytes } from 'crypto';
import { promisify } from 'util';
import * as forge from 'node-forge';

const generateKeyPairAsync = promisify(generateKeyPair);

/** Serial dương, 16 byte ngẫu nhiên (hex) — byte đầu < 0x80 để DER không thêm 00. */
export function randomSerialHex(bytes = 16): string {
    const b = randomBytes(bytes);
    b[0] = (b[0] & 0x7f) || 0x01;
    return b.toString('hex');
}

/** Sinh cặp khoá RSA ở threadpool (không chặn event loop). Trả private key PKCS#8 PEM + public key SPKI PEM. */
export async function generateRsaKeyPair(modulusLength: number): Promise<{ privateKeyPem: string; publicKeyPem: string }> {
    const { privateKey, publicKey } = await generateKeyPairAsync('rsa', {
        modulusLength,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

export function certToDer(cert: forge.pki.Certificate): Buffer {
    return Buffer.from(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes(), 'binary');
}

export function certFingerprintSha256(cert: forge.pki.Certificate): string {
    return createHash('sha256').update(certToDer(cert)).digest('hex');
}

/**
 * forge KHÔNG tự mã hoá UTF-8 cho thuộc tính DN: ghi giá trị Unicode (vd. tiếng Việt có dấu) thẳng vào UTF8String sẽ sinh
 * DER sai độ dài. Vì vậy phải encodeUtf8 khi tạo subject và decodeUtf8 khi đọc lại (dnToString / dnValue).
 */
export function utf8Value(value: string): string {
    return forge.util.encodeUtf8(value);
}

export function decodeDnValue(raw: unknown): string {
    const text = String(raw ?? '');
    try {
        return forge.util.decodeUtf8(text);
    } catch {
        return text;
    }
}

export function dnToString(attrs: forge.pki.CertificateField[]): string {
    return attrs.map((a) => `${a.shortName ?? a.name}=${decodeDnValue(a.value)}`).join(', ');
}

/** Tách mọi khối CERTIFICATE trong chuỗi PEM. */
export function parseCertificatesPem(pem: string): forge.pki.Certificate[] {
    return forge.pem
        .decode(pem)
        .filter((m) => m.type === 'CERTIFICATE')
        .map((m) => forge.pki.certificateFromAsn1(forge.asn1.fromDer(m.body)));
}

export function certsToPem(certs: forge.pki.Certificate[]): string {
    return certs.map((c) => forge.pki.certificateToPem(c)).join('');
}

/** Bỏ dấu tiếng Việt — dùng cho trường trong signature dictionary của PDF (PDFString không an toàn với Unicode). */
export function asciiFold(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .replace(/[^\x20-\x7e]/g, '?');
}

/** So sánh serial hex không phân biệt hoa/thường và số 0 đứng đầu. */
export function sameSerial(a: string, b: string): boolean {
    const norm = (s: string) => s.toLowerCase().replace(/^0+/, '');
    return norm(a) === norm(b);
}

export function toForgePrivateKey(pkcs8Pem: string): forge.pki.rsa.PrivateKey {
    return forge.pki.privateKeyFromPem(pkcs8Pem) as forge.pki.rsa.PrivateKey;
}
