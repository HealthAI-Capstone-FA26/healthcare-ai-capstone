// Chạy TRƯỚC khi app được import (jest `setupFiles`).
//
// Nạp .env nằm ở thư mục gốc dự án (cùng cấp với folder `test`). Dùng đường dẫn tuyệt đối theo
// vị trí file này (test/e2e -> ../../.env) nên chạy jest từ thư mục nào cũng tìm đúng.
// dotenv KHÔNG ghi đè biến đã có sẵn trong shell/CI.
import * as path from 'path';
import * as dotenv from 'dotenv';

// Lưu lại DATABASE_URL do người chạy truyền vào shell TRƯỚC khi nạp .env.
const shellDatabaseUrl = process.env.DATABASE_URL;
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// AN TOÀN: e2e ghi dữ liệu thật vào DB (tạo user/patient/encounter...). Vì vậy KHÔNG BAO GIỜ dùng
// DATABASE_URL trong .env (có thể trỏ vào Neon/dev). DB e2e lấy từ: DATABASE_URL truyền ở shell/CI,
// hoặc DATABASE_URL (đặt trong .env hoặc shell).
const e2eDatabaseUrl = shellDatabaseUrl || process.env.DATABASE_URL;
if (!e2eDatabaseUrl) {
  throw new Error(
    'Thiếu DB cho e2e. Đặt DATABASE_URL trong .env hoặc chạy: DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hospital_e2e npm run test:e2e',
  );
}

process.env.DATABASE_URL = e2eDatabaseUrl;
process.env.NODE_ENV = 'test';

// Trong môi trường test/e2e, trỏ MINIO_ENDPOINT về 127.0.0.1 để tránh Windows tốn nhiều giây
// phân giải DNS/NetBIOS cho hostname 'minio' từ .env khi chạy ngoài Docker.
process.env.MINIO_ENDPOINT = '127.0.0.1';

// Chỉ điền giá trị mặc định nếu chưa có (CI đặt qua `env:`, local lấy từ .env).
const defaults: Record<string, string> = {
  JWT_SECRET: 'e2e-jwt-secret',
  REFRESH_TOKEN_SECRET: 'e2e-refresh-secret',
  RESET_PASSWORD_SECRET: 'e2e-reset-secret',
  REDIS_URL: 'redis://localhost:6379',
  ACCESS_TOKEN_TTL_MINUTES: '60',
  MAIL_FROM_EMAIL: 'noreply@e2e.test',
  BREVO_API_KEY: 'e2e-dummy',
};
for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) process.env[key] = value;
}