/** Event nội bộ (EventEmitter2) do QueueTicketService phát; QueueTicketGateway lắng nghe để đẩy realtime tới màn hình hiển thị. */
export const QUEUE_TICKET_EVENT = {
  ISSUED: 'queue-ticket.issued',
  CALLED: 'queue-ticket.called',
  DONE: 'queue-ticket.done',
} as const;
export type QueueTicketEventName = (typeof QUEUE_TICKET_EVENT)[keyof typeof QUEUE_TICKET_EVENT];

/**
 * Payload CỐ Ý không chứa thông tin bệnh nhân (tên, SĐT...): màn hình công cộng chỉ cần số + quầy.
 * `ticketDate` dạng YYYY-MM-DD, dùng để chọn room.
 */
export interface QueueTicketEventPayload {
  ticketId: string;
  ticketLabel: string; // vd. "A012", "B005"
  ticketPrefix: string;
  ticketNumber: number;
  ticketDate: string;
  status: string;
  counterNumber: string | null;
  calledAt: string | null;
  waitingCount: number;
}
