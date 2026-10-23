-- PKI / CA cho chữ ký số đơn thuốc (SE06).
-- Viết tay theo quy ước đặt tên của Prisma; nên đối chiếu lại bằng `prisma migrate diff` khi có kết nối DB.

-- CreateTable
CREATE TABLE "pki_authorities" (
    "authority_id" CHAR(36) NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "subject_dn" VARCHAR(500) NOT NULL,
    "serial_number" VARCHAR(64) NOT NULL,
    "fingerprint_sha256" CHAR(64) NOT NULL,
    "cert_pem" TEXT NOT NULL,
    "encrypted_private_key" TEXT,
    "not_before" TIMESTAMP(3) NOT NULL,
    "not_after" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pki_authorities_pkey" PRIMARY KEY ("authority_id")
);

-- CreateTable
CREATE TABLE "doctor_certificates" (
    "certificate_id" CHAR(36) NOT NULL,
    "doctor_id" CHAR(36) NOT NULL,
    "authority_id" CHAR(36),
    "source" VARCHAR(20) NOT NULL,
    "serial_number" VARCHAR(64) NOT NULL,
    "subject_dn" VARCHAR(500) NOT NULL,
    "issuer_dn" VARCHAR(500) NOT NULL,
    "fingerprint_sha256" CHAR(64) NOT NULL,
    "cert_pem" TEXT NOT NULL,
    "chain_pem" TEXT,
    "encrypted_private_key" TEXT NOT NULL,
    "not_before" TIMESTAMP(3) NOT NULL,
    "not_after" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" VARCHAR(255),
    "revoked_by_user_id" CHAR(36),
    "issued_by_user_id" CHAR(36),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_certificates_pkey" PRIMARY KEY ("certificate_id")
);

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN "signature_certificate_id" CHAR(36);

-- CreateIndex
CREATE UNIQUE INDEX "pki_authorities_fingerprint_sha256_key" ON "pki_authorities"("fingerprint_sha256");
CREATE INDEX "pki_authorities_kind_status_idx" ON "pki_authorities"("kind", "status");
CREATE UNIQUE INDEX "doctor_certificates_fingerprint_sha256_key" ON "doctor_certificates"("fingerprint_sha256");
CREATE INDEX "doctor_certificates_doctor_id_status_idx" ON "doctor_certificates"("doctor_id", "status");
CREATE INDEX "doctor_certificates_serial_number_idx" ON "doctor_certificates"("serial_number");
CREATE INDEX "prescriptions_signature_certificate_id_idx" ON "prescriptions"("signature_certificate_id");

-- AddForeignKey
ALTER TABLE "doctor_certificates" ADD CONSTRAINT "doctor_certificates_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("doctor_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "doctor_certificates" ADD CONSTRAINT "doctor_certificates_authority_id_fkey" FOREIGN KEY ("authority_id") REFERENCES "pki_authorities"("authority_id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_signature_certificate_id_fkey" FOREIGN KEY ("signature_certificate_id") REFERENCES "doctor_certificates"("certificate_id") ON DELETE SET NULL ON UPDATE CASCADE;
