import { randomInt } from 'crypto';

export function generateEntityCode(prefix: string): string {
  const now = new Date();
  // Dùng padStart chuẩn hóa ngày tháng năm
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  

  const random = String(randomInt(0, 1_000_000)).padStart(6, '0');

  return `${prefix}${yy}${mm}${dd}${random}`;
}

export async function generateUniqueCode(
  prefix: string,
  isTaken: (code: string) => Promise<boolean>,
  maxAttempts = 5,
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const code = generateEntityCode(prefix);
    if (!(await isTaken(code))) {
      return code;
    }
  }

  throw new Error(`Không thể sinh mã unique cho prefix "${prefix}" sau ${maxAttempts} lần thử.`);
}