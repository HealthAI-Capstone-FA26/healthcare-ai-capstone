import { QueueTicket } from '@prisma/client';

// prefix = 'A' cho appointment online (ticket được tạo lúc bệnh nhân TỚI department, không phải
// lúc đặt online). prefix = 'B' cho at_hospital (tạo ngay lúc lễ tân tạo appointment — Phase 5).
export enum QueueTicketPrefix {
  ONLINE = 'A',
  AT_HOSPITAL = 'B',
}

// QueueTicket chỉ dùng để bốc số + quản lý ưu tiên gọi số, KHÔNG biểu thị "đang khám".
// waiting -> called -> done, hết. Bước khám (Encounter) là một quy trình riêng, bắt đầu SAU
// khi ticket đạt done (xem QueueTicketService.done()), không còn trạng thái `serving` trung gian.
export enum QueueTicketStatus {
  WAITING = 'waiting',
  CALLED = 'called',
  DONE = 'done',
  SKIPPED = 'skipped',
  CANCELLED = 'cancelled',
}

// Rank càng nhỏ càng được ưu tiên, áp dụng CHO CÙNG 1 prefix (urgent chỉ lên đầu nhóm của mình,
// không vượt ranh giới online/at_hospital). Riêng `emergency` xử lý riêng ở compareQueueTickets
// bên dưới vì nó vượt cả ranh giới prefix — quyết định chốt cho Câu hỏi mở #2 Phase 5.
export const QUEUE_TICKET_PRIORITY_RANK: Record<string, number> = {
  emergency: 0,
  urgent: 1,
  normal: 2,
};

// Chuẩn hoá 1 Date về mốc 00:00 UTC để so khớp với cột ticket_date (@db.Date).
export function toDateOnlyUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

type QueueTicketWithPriority = QueueTicket & { appointment: { priority: string } };

// Thứ tự hiển thị/gọi số:
//  1. `emergency` lên đầu TOÀN BỘ hàng đợi department, vượt cả ranh giới online/at_hospital
//     (đe doạ tính mạng thì công bằng giữa 2 kênh không còn là ưu tiên số 1) — FIFO nội bộ
//     giữa các ticket emergency với nhau, bất kể prefix.
//  2. Còn lại: prefix A (online) trước B (at_hospital) trong cùng department.
//  3. Trong cùng prefix: `urgent` lên đầu nhóm của chính nó (không vượt ranh giới prefix).
//  4. Cùng priority: FIFO theo ticketNumber.
export function compareQueueTickets(a: QueueTicketWithPriority, b: QueueTicketWithPriority): number {
  const aEmergency = a.appointment.priority === 'emergency';
  const bEmergency = b.appointment.priority === 'emergency';
  if (aEmergency !== bEmergency) {
    return aEmergency ? -1 : 1;
  }
  if (aEmergency && bEmergency) {
    return a.ticketNumber - b.ticketNumber;
  }

  if (a.ticketPrefix !== b.ticketPrefix) {
    return a.ticketPrefix < b.ticketPrefix ? -1 : 1;
  }

  const rankA = QUEUE_TICKET_PRIORITY_RANK[a.appointment.priority] ?? QUEUE_TICKET_PRIORITY_RANK.normal;
  const rankB = QUEUE_TICKET_PRIORITY_RANK[b.appointment.priority] ?? QUEUE_TICKET_PRIORITY_RANK.normal;
  if (rankA !== rankB) {
    return rankA - rankB;
  }

  return a.ticketNumber - b.ticketNumber;
}