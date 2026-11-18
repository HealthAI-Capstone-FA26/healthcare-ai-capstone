import { TriageQueueEntry } from '@prisma/client';

// Đúng comment field `status` của model TriageQueueEntry trong prisma/schema.prisma (dòng ~731).
// Khác với QueueTicket (chỉ bốc số/gọi số), TriageQueueEntry còn có IN_PROGRESS vì nó theo dõi
// luôn cả lúc y tá đang đo sinh hiệu (Module vitals), không dừng ở "đã gọi".
export enum TriageQueueStatus {
  WAITING = 'waiting',
  CALLED = 'called',
  IN_PROGRESS = 'in_progress',
  DONE = 'done',
  SKIPPED = 'skipped',
  CANCELLED = 'cancelled',
}

// Rank càng nhỏ càng được ưu tiên — copy đúng pattern QUEUE_TICKET_PRIORITY_RANK
// (src/common/constants/queue-ticket.constants.ts), value lấy từ Appointment.priority tại thời
// điểm enqueue (xem TriageQueueService.enqueue).
export const TRIAGE_QUEUE_PRIORITY_RANK: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  normal: 2,
};

// Danh sách policy bắt buộc phải có consent active trước khi cho phép complete-registration.
// LƯU Ý: danh sách này cần đội nghiệp vụ/pháp lý xác nhận lại trước khi lên production, hiện lấy
// theo 2 policy bắt buộc nhất — data_processing và treatment_consent — không chặn
// financial_responsibility (xem module3.md mục 2, quyết định "Policy bắt buộc trước khi vào queue").
export const MANDATORY_CONSENT_POLICY_TYPES: string[] = ['data_processing', 'treatment_consent'];

type TriageQueueEntryWithPriority = Pick<TriageQueueEntry, 'priority' | 'queueOrder'>;

// Thứ tự hiển thị/gọi hàng đợi triage của 1 khoa:
//  1. `emergency` lên đầu TOÀN BỘ hàng đợi của khoa, vượt ranh giới bất kỳ nhóm nào khác (giống
//     compareQueueTickets) — FIFO theo queueOrder nội bộ giữa các entry emergency với nhau.
//  2. Còn lại: cùng priority thì so theo queueOrder tăng dần (FIFO).
//  KHÔNG cần phân biệt prefix online/at_hospital như QueueTicket — khái niệm đó không áp dụng ở
//  đây vì TriageQueueEntry chỉ có 1 nguồn duy nhất là encounter đã hoàn tất tiếp đón.
export function compareTriageQueueEntries(
  a: TriageQueueEntryWithPriority,
  b: TriageQueueEntryWithPriority,
): number {
  const aEmergency = a.priority === 'emergency';
  const bEmergency = b.priority === 'emergency';
  if (aEmergency !== bEmergency) {
    return aEmergency ? -1 : 1;
  }
  if (aEmergency && bEmergency) {
    return a.queueOrder - b.queueOrder;
  }

  const rankA = TRIAGE_QUEUE_PRIORITY_RANK[a.priority] ?? TRIAGE_QUEUE_PRIORITY_RANK.normal;
  const rankB = TRIAGE_QUEUE_PRIORITY_RANK[b.priority] ?? TRIAGE_QUEUE_PRIORITY_RANK.normal;
  if (rankA !== rankB) {
    return rankA - rankB;
  }

  return a.queueOrder - b.queueOrder;
}
