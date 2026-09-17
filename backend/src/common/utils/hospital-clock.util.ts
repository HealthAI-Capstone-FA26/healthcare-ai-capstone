// Tách ra dùng chung từ queue-ticket.service.ts (Phase 1 — module3.md mục 5 BƯỚC 1): nhiều nơi
// cần "giờ hiện tại theo giờ bệnh viện" để tính ticketDate/triageQueueDate (VD: TriageQueueService
// dùng lại y hệt để tính triageQueueDate), không nên mỗi service tự định nghĩa 1 bản riêng.
export function getHospitalWallClockNow(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, Number(value)]));

  return new Date(
    Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second),
  );
}
