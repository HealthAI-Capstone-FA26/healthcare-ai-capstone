// Chạy TRƯỚC khi app được import (jest `setupFiles`).
//
// AN TOÀN: e2e ghi dữ liệu thật vào DB (tạo user/patient/encounter...). Vì vậy KHÔNG dùng
// DATABASE_URL trong .env (có thể trỏ vào Neon/dev). Bắt buộc phải truyền E2E_DATABASE_URL riêng.
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL;
if (!e2eDatabaseUrl) {
  throw new Error(
    'Thiếu E2E_DATABASE_URL. Ví dụ: E2E_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/hospital_e2e npm run test:e2e',
  );
}

process.env.DATABASE_URL = e2eDatabaseUrl;
process.env.NODE_ENV = 'test';

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
