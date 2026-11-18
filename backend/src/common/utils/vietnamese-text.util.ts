// Chuẩn hoá text tiếng Việt để so khớp từ khoá không phân biệt hoa/thường và dấu câu/dấu thanh:
// "Đau Bụng dữ dội" -> "dau bung du doi". Dùng chung cho input triệu chứng (client nhập) và
// symptomKeywords (lưu trong DB) trước khi so khớp, để tránh sai lệch do người dùng gõ không dấu,
// viết hoa/thường tuỳ ý.
export function normalizeVietnameseText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // bỏ các dấu thanh (sắc, huyền, hỏi, ngã, nặng, mũ, trăng...)
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}
