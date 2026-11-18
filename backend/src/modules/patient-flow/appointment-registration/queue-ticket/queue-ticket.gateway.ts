import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { QueueTicketStatus, toDateOnlyUTC } from '../../../../common/constants/queue-ticket.constants';
import { getHospitalWallClockNow } from '../../../../common/utils/hospital-clock.util';
import { QUEUE_TICKET_EVENT, QueueTicketEventPayload } from './queue-ticket.events';

/**
 * CORS: đặt QUEUE_DISPLAY_CORS_ORIGINS (danh sách origin, phân tách bằng dấu phẩy). Không đặt: dev cho phép mọi
 * origin, production từ chối cross-origin (cùng quy ước với lab-alerts / vital-alerts).
 */
const QUEUE_DISPLAY_CORS_ORIGIN: string[] | string | boolean = process.env.QUEUE_DISPLAY_CORS_ORIGINS
  ? process.env.QUEUE_DISPLAY_CORS_ORIGINS.split(',').map((o) => o.trim())
  : process.env.NODE_ENV === 'production'
    ? false
    : '*';

const NOW_CALLING_LIMIT = 8;

/**
 * Gateway realtime cho MÀN HÌNH HIỂN THỊ HÀNG ĐỢI tại sảnh/quầy tiếp đón (SE01 — "callouts appear on the electronic
 * display screens"). Namespace '/queue-display'.
 *
 * Client (màn hình TV) kết nối rồi emit 'subscribe' { date?: 'YYYY-MM-DD' } (mặc định hôm nay theo giờ bệnh viện):
 *   - ack trả snapshot { date, waitingCount, nowCalling[] } để vẽ màn hình ngay lần đầu / sau khi mất kết nối;
 *   - sau đó nhận 'queue-ticket-issued' | 'queue-ticket-called' | 'queue-ticket-done' (payload: QueueTicketEventPayload).
 * KHÔNG yêu cầu JWT vì màn hình công cộng không có tài khoản; vì vậy payload tuyệt đối không chứa dữ liệu bệnh nhân —
 * chỉ số thứ tự, quầy và số người đang chờ.
 */
@WebSocketGateway({ namespace: 'queue-display', cors: { origin: QUEUE_DISPLAY_CORS_ORIGIN } })
export class QueueTicketGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(QueueTicketGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(private readonly prisma: PrismaService) { }

  handleConnection(client: Socket) {
    this.logger.log(`Queue display connected: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Queue display disconnected: ${client.id}`);
  }

  @SubscribeMessage('subscribe')
  async handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() body?: { date?: string }) {
    const date = this.normalizeDate(body?.date);
    await client.join(this.roomName(date));
    return { status: 'subscribed', ...(await this.snapshot(date)) };
  }

  @SubscribeMessage('unsubscribe')
  async handleUnsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body?: { date?: string }) {
    const date = this.normalizeDate(body?.date);
    await client.leave(this.roomName(date));
    return { status: 'unsubscribed', date };
  }

  @OnEvent(QUEUE_TICKET_EVENT.ISSUED)
  onIssued(payload: QueueTicketEventPayload) {
    this.server?.to(this.roomName(payload.ticketDate)).emit('queue-ticket-issued', payload);
  }

  @OnEvent(QUEUE_TICKET_EVENT.CALLED)
  onCalled(payload: QueueTicketEventPayload) {
    this.server?.to(this.roomName(payload.ticketDate)).emit('queue-ticket-called', payload);
  }

  @OnEvent(QUEUE_TICKET_EVENT.DONE)
  onDone(payload: QueueTicketEventPayload) {
    this.server?.to(this.roomName(payload.ticketDate)).emit('queue-ticket-done', payload);
  }

  /** Số đang được gọi (mới nhất trước) + số người đang chờ — cho màn hình vẽ lần đầu. */
  private async snapshot(date: string) {
    const ticketDate = toDateOnlyUTC(new Date(date));
    const [called, waitingCount] = await Promise.all([
      this.prisma.queueTicket.findMany({
        where: { ticketDate, status: QueueTicketStatus.CALLED },
        orderBy: { calledAt: 'desc' },
        take: NOW_CALLING_LIMIT,
        select: { ticketId: true, ticketPrefix: true, ticketNumber: true, counterNumber: true, calledAt: true },
      }),
      this.prisma.queueTicket.count({ where: { ticketDate, status: QueueTicketStatus.WAITING } }),
    ]);
    return {
      date,
      waitingCount,
      nowCalling: called.map((t) => ({
        ticketId: t.ticketId,
        ticketLabel: `${t.ticketPrefix}${String(t.ticketNumber).padStart(3, '0')}`,
        counterNumber: t.counterNumber,
        calledAt: t.calledAt?.toISOString() ?? null,
      })),
    };
  }

  private normalizeDate(input?: string): string {
    if (input && /^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
    return toDateOnlyUTC(getHospitalWallClockNow()).toISOString().slice(0, 10);
  }

  private roomName(date: string): string {
    return `queue-display:${date}`;
  }
}
