import { randomInt } from 'crypto';

/**
 * Sinh mã dạng "${PREFIX}${YYMMDD}${4 số ngẫu nhiên}", ví dụ: BN2408210417.
 * Không đảm bảo unique tuyệt đối -> nơi gọi cần retry (xem generateUniqueCode).
 */
export function generateEntityCode(prefix: string): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const random = String(randomInt(0, 10_000)).padStart(4, '0');

  return `${prefix}${yy}${mm}${dd}${random}`;
}

/**
 * Retry sinh code cho tới khi `isTaken` trả về false (hoặc hết số lần thử).
 * Dùng cho các field code unique (patientCode, doctorCode...) tránh đụng độ hiếm gặp.
 */
export async function generateUniqueCode(
  prefix: string,
  isTaken: (code: string) => Promise<boolean>,
  maxAttempts = 5,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateEntityCode(prefix);
    // eslint-disable-next-line no-await-in-loop
    if (!(await isTaken(code))) {
      return code;
    }
  }

  throw new Error(`Không thể sinh mã unique cho prefix "${prefix}" sau ${maxAttempts} lần thử`);
}
