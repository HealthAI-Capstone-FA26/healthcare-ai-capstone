-- DropForeignKey
ALTER TABLE "chief_complaints" DROP CONSTRAINT "chief_complaints_recorded_by_user_id_fkey";

-- AlterTable
ALTER TABLE "chief_complaints" ALTER COLUMN "recorded_by_user_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "chief_complaints" ADD CONSTRAINT "chief_complaints_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
