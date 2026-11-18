import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Mã hoá/giải mã private key (CA và bác sĩ) bằng AES-256-GCM trước khi lưu DB.
 * Khoá chủ (master key) lấy từ PKI_MASTER_KEY — 32 byte dạng hex (64 ký tự) hoặc base64.
 *
 * Production: BẮT BUỘC đặt PKI_MASTER_KEY (nên cấp từ KMS/HSM/secret manager, không commit vào repo).
 * Dev: nếu thiếu sẽ dẫn xuất từ JWT_SECRET kèm cảnh báo — chỉ để chạy thử, KHÔNG dùng cho dữ liệu thật.
 *
 * Định dạng lưu: "v1.<iv>.<authTag>.<ciphertext>" (base64url).
 */
@Injectable()
export class PkiKeyVaultService {
    private readonly logger = new Logger(PkiKeyVaultService.name);
    private cachedKey?: Buffer;

    private masterKey(): Buffer {
        if (this.cachedKey) return this.cachedKey;

        const raw = process.env.PKI_MASTER_KEY?.trim();
        if (raw) {
            const key = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
            if (key.length !== 32) {
                throw new InternalServerErrorException('PKI_MASTER_KEY phải là 32 byte (64 ký tự hex hoặc base64 của 32 byte).');
            }
            this.cachedKey = key;
            return key;
        }

        if (process.env.NODE_ENV === 'production') {
            throw new InternalServerErrorException('Thiếu PKI_MASTER_KEY — không thể bảo vệ private key trong môi trường production.');
        }
        this.logger.warn('PKI_MASTER_KEY chưa đặt — dùng khoá dẫn xuất từ JWT_SECRET (CHỈ cho dev/test).');
        this.cachedKey = scryptSync(process.env.JWT_SECRET || 'dev-only-insecure-secret', 'healthai-pki-dev-salt', 32);
        return this.cachedKey;
    }

    encrypt(plaintext: string): string {
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.masterKey(), iv);
        const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
    }

    decrypt(blob: string): string {
        const [version, iv, tag, ciphertext] = blob.split('.');
        if (version !== 'v1' || !iv || !tag || !ciphertext) {
            throw new InternalServerErrorException('Định dạng private key đã mã hoá không hợp lệ.');
        }
        try {
            const decipher = createDecipheriv('aes-256-gcm', this.masterKey(), Buffer.from(iv, 'base64url'));
            decipher.setAuthTag(Buffer.from(tag, 'base64url'));
            return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
        } catch {
            throw new InternalServerErrorException('Không giải mã được private key (sai PKI_MASTER_KEY hoặc dữ liệu bị sửa).');
        }
    }
}
