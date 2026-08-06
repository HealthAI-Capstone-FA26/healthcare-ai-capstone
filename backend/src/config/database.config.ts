// Chỗ để cấu hình kết nối database sau này (TypeORM/Prisma/Mongoose...).
// Hiện tại CHƯA cấu hình / CHƯA kết nối gì cả — chỉ đặt sườn.
//
// Ví dụ khi triển khai thật với TypeORM:
//
// import { TypeOrmModuleOptions } from '@nestjs/typeorm';
//
// export const databaseConfig: TypeOrmModuleOptions = {
//   type: 'postgres',
//   host: process.env.DB_HOST,
//   port: Number(process.env.DB_PORT),
//   username: process.env.DB_USERNAME,
//   password: process.env.DB_PASSWORD,
//   database: process.env.DB_NAME,
//   entities: [],
//   synchronize: false,
// };

export const databaseConfig = {};
