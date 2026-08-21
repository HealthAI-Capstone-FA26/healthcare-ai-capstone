// Các hằng số dùng chung cho toàn bộ module Auth.
// Trước đây các giá trị này bị lặp lại (copy-paste) ở nhiều service khác nhau.
export const SALT_ROUNDS = 10;
export const OTP_LENGTH = 6;
export const MAX_OTP_ATTEMPTS = 5;
export const DEFAULT_ACTOR_ROLE = 'patient';
export const RESET_PASSWORD_PURPOSE = 'password_reset';

// Buffer cộng thêm vào TTL Redis để logic check hạn trong service luôn chạy
// trước khi Redis tự dọn key (tránh race condition giữa "hết hạn theo logic"
// và "hết hạn theo Redis TTL").
export const OTP_TTL_BUFFER_SECONDS = 60;
