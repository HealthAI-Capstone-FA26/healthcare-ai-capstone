-- AlterTable: thêm cột status cho patients (draft: hồ sơ tạo từ đặt lịch guest chưa xác nhận,
-- main: hồ sơ chính thức). Patient đã tồn tại trước đó coi như đã được xác nhận -> mặc định 'main',
-- patient tạo mới về sau mặc định 'draft' (service tự set 'main' cho các luồng tạo có xác thực).
ALTER TABLE "patients" ADD COLUMN "status" VARCHAR(10) NOT NULL DEFAULT 'draft';

-- Patient hiện có trong DB (được tạo qua các luồng đã xác thực trước khi có cột này) coi như hợp lệ.
UPDATE "patients" SET "status" = 'main';

-- CreateIndex: phục vụ cronjob quét patient draft quá hạn để dọn dẹp mỗi ngày.
CREATE INDEX "patients_status_created_at_idx" ON "patients"("status", "created_at");
