import { Module } from '@nestjs/common';

// Sườn module database — CHƯA cấu hình/kết nối gì cả.
// Sau này import ORM tương ứng (TypeOrmModule.forRoot, MongooseModule.forRoot, ...)
// và truyền databaseConfig từ '../config/database.config' vào đây.

@Module({})
export class DatabaseModule {}
