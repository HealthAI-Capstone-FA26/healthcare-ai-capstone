/*
  Warnings:

  - The primary key for the `user_roles` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_pkey",
ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("user_id");

-- CreateTable
CREATE TABLE "registration_otps" (
    "registration_id" CHAR(36) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "full_name" VARCHAR(255) NOT NULL,
    "phone_number" VARCHAR(20),
    "actor_role" VARCHAR(20) NOT NULL DEFAULT 'patient',
    "password_hash" VARCHAR(255) NOT NULL,
    "otp_code_hash" VARCHAR(255) NOT NULL,
    "otp_expires_at" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registration_otps_pkey" PRIMARY KEY ("registration_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "registration_otps_email_key" ON "registration_otps"("email");
