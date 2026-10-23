/**
 * Hợp đồng dùng chung giữa module PKI và các module nghiệp vụ (vd. prescription).
 * Module nghiệp vụ KHÔNG biết chi tiết CA/khoá — chỉ nhận một PdfSigner để ký file PDF đã dựng xong.
 */
export interface PdfSigner {
    /** Các trường hiển thị trong signature dictionary của PDF (nên là ASCII). */
    name: string;
    reason: string;
    location: string;
    contactInfo: string;
    /** Số byte dành sẵn cho chữ ký CMS (placeholder) — đủ chứa chuỗi chứng thư. */
    signatureLength: number;
    /** Nhận PDF đã có placeholder chữ ký (save với useObjectStreams=false), trả PDF đã ký (PAdES/adbe.pkcs7.detached). */
    sign(pdfWithPlaceholder: Buffer): Promise<Buffer>;
}

export interface PdfSignatureCheck {
    code: string;
    ok: boolean;
    message: string;
}

export interface PdfSignatureVerification {
    /** true khi mọi kiểm tra bắt buộc đều đạt. */
    valid: boolean;
    checks: PdfSignatureCheck[];
    signer?: {
        subject: string;
        issuer: string;
        serialNumber: string;
        fingerprintSha256: string;
        notBefore: string;
        notAfter: string;
    };
    /** signingTime nằm trong CMS (do bên ký khai) — chỉ mang tính tham khảo; mốc tin cậy là signedAt trong DB. */
    cmsSigningTime?: string;
    certificateStatus?: 'active' | 'revoked' | 'unknown';
    revokedAt?: string;
    /** true nếu chứng thư bị thu hồi SAU thời điểm ký (chữ ký vẫn hợp lệ tại thời điểm ký). */
    revokedAfterSigning?: boolean;
}

export const PKI_SOURCE = { INTERNAL_CA: 'internal_ca', IMPORTED: 'imported' } as const;
export const AUTHORITY_KIND = { INTERNAL_ROOT: 'internal_root', TRUSTED_EXTERNAL: 'trusted_external' } as const;
