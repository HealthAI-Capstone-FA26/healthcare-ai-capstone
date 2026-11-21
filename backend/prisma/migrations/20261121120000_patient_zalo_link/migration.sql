-- Liên k?t b?nh nhân v?i Zalo Bot chat_id.
-- CreateTable
CREATE TABLE "patient_zalo_links" (
    "link_id" CHAR(36) NOT NULL,
    "patient_id" CHAR(36) NOT NULL,
    "chat_id" VARCHAR(100) NOT NULL,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_zalo_links_pkey" PRIMARY KEY ("link_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "patient_zalo_links_patient_id_key" ON "patient_zalo_links"("patient_id");

-- CreateIndex
CREATE INDEX "patient_zalo_links_chat_id_idx" ON "patient_zalo_links"("chat_id");
