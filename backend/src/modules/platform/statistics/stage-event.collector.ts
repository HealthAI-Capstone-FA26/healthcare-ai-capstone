import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { StageCode } from './statistics.constants';
import { hospitalDayBounds } from './statistics.util';

/** 1 lượt vào-ra của 1 chặng — nguồn chung cho EncounterStageEvent (thô) và StageStatistic (tổng hợp). */
export interface StageSample {
  /** null: chưa có Encounter (vd. số thứ tự / hoá đơn phí khám trước thanh toán) -> chỉ dùng cho thống kê, không lưu event. */
  encounterId: string | null;
  stage: StageCode;
  serviceId: string | null;
  referenceType: string;
  referenceId: string;
  enteredAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * Suy ra các chặng của lượt khám từ timestamp ĐÃ CÓ SẴN trong các bảng nghiệp vụ (hàng đợi, hoá đơn, cận lâm sàng...),
 * nên KHÔNG phải chèn code ghi sự kiện vào từng service nghiệp vụ và luôn idempotent (chạy lại ra cùng kết quả).
 * Mỗi chặng thuộc ngày nào là theo `enteredAt` (giờ bệnh viện, UTC+7).
 */
@Injectable()
export class StageEventCollector {
  constructor(private readonly prisma: PrismaService) { }

  async collect(dateStr: string): Promise<StageSample[]> {
    const { start, end } = hospitalDayBounds(dateStr);
    const range = { gte: start, lt: end };
    const out: StageSample[] = [];

    // 1) Tiếp đón: bốc số -> được gọi (reception_queue), được gọi -> check-in xong (reception_checkin)
    const tickets = await this.prisma.queueTicket.findMany({
      where: { issuedAt: range, calledAt: { not: null } },
      select: {
        ticketId: true,
        issuedAt: true,
        calledAt: true,
        appointment: {
          select: {
            encounter: { select: { encounterId: true } },
            receptionCheckins: { select: { checkinTime: true }, orderBy: { checkinTime: 'asc' }, take: 1 },
          },
        },
      },
    });
    for (const t of tickets) {
      const encounterId = t.appointment?.encounter?.encounterId ?? null;
      const checkinTime = t.appointment?.receptionCheckins[0]?.checkinTime ?? null;
      out.push({
        encounterId, stage: 'reception_queue', serviceId: null, referenceType: 'queue_ticket', referenceId: t.ticketId,
        enteredAt: t.issuedAt, startedAt: t.calledAt, completedAt: null,
      });
      out.push({
        encounterId, stage: 'reception_checkin', serviceId: null, referenceType: 'queue_ticket', referenceId: t.ticketId,
        enteredAt: t.calledAt!, startedAt: t.calledAt, completedAt: checkinTime,
      });
    }

    // 2) Phí khám / thanh toán: phát hành hoá đơn -> bắt đầu trả -> trả xong
    const invoices = await this.prisma.invoice.findMany({
      where: { issuedAt: range, payments: { some: { status: 'success', paidAt: { not: null } } } },
      select: {
        invoiceId: true,
        encounterId: true,
        issuedAt: true,
        payments: {
          where: { status: 'success', paidAt: { not: null } },
          select: { createdAt: true, paidAt: true },
          orderBy: { paidAt: 'asc' },
          take: 1,
        },
      },
    });
    for (const inv of invoices) {
      const pay = inv.payments[0];
      if (!pay) continue;
      out.push({
        encounterId: inv.encounterId, stage: 'payment', serviceId: null, referenceType: 'invoice', referenceId: inv.invoiceId,
        enteredAt: inv.issuedAt, startedAt: pay.createdAt, completedAt: pay.paidAt,
      });
    }

    // 3) Hàng đợi điều dưỡng: chờ tới khi bắt đầu đo (triage_wait), đo sinh hiệu (vitals)
    const triage = await this.prisma.triageQueueEntry.findMany({
      where: { enteredQueueAt: range },
      select: { queueEntryId: true, encounterId: true, enteredQueueAt: true, calledAt: true, startedAt: true, completedAt: true },
    });
    for (const e of triage) {
      const started = e.startedAt ?? e.calledAt;
      out.push({
        encounterId: e.encounterId, stage: 'triage_wait', serviceId: null, referenceType: 'triage_queue', referenceId: e.queueEntryId,
        enteredAt: e.enteredQueueAt, startedAt: started, completedAt: null,
      });
      if (e.startedAt) {
        out.push({
          encounterId: e.encounterId, stage: 'vitals', serviceId: null, referenceType: 'triage_queue', referenceId: e.queueEntryId,
          enteredAt: e.startedAt, startedAt: e.startedAt, completedAt: e.completedAt,
        });
      }
    }

    // 4) Hàng đợi bác sĩ: chờ (doctor_wait), khám (consultation)
    const doctorQueue = await this.prisma.doctorQueueEntry.findMany({
      where: { enteredQueueAt: range },
      select: { queueEntryId: true, encounterId: true, enteredQueueAt: true, calledAt: true, examStartedAt: true, examEndedAt: true },
    });
    for (const e of doctorQueue) {
      out.push({
        encounterId: e.encounterId, stage: 'doctor_wait', serviceId: null, referenceType: 'doctor_queue', referenceId: e.queueEntryId,
        enteredAt: e.enteredQueueAt, startedAt: e.examStartedAt ?? e.calledAt, completedAt: null,
      });
      if (e.examStartedAt) {
        out.push({
          encounterId: e.encounterId, stage: 'consultation', serviceId: null, referenceType: 'doctor_queue', referenceId: e.queueEntryId,
          enteredAt: e.examStartedAt, startedAt: e.examStartedAt, completedAt: e.examEndedAt,
        });
      }
    }

    // 5) Cận lâm sàng theo từng dịch vụ: chờ trong hàng đợi phòng (diagnostic_wait), thực hiện (diagnostic_execution)
    const tasks = await this.prisma.diagnosticTask.findMany({
      where: { readyAt: range },
      select: {
        taskId: true,
        readyAt: true,
        receivedAt: true,
        startedAt: true,
        completedAt: true,
        orderItem: { select: { serviceId: true, order: { select: { encounterId: true } } } },
      },
    });
    for (const t of tasks) {
      const encounterId = t.orderItem.order.encounterId;
      const serviceId = t.orderItem.serviceId;
      out.push({
        encounterId, stage: 'diagnostic_wait', serviceId, referenceType: 'diagnostic_task', referenceId: t.taskId,
        enteredAt: t.readyAt!, startedAt: t.startedAt ?? t.receivedAt, completedAt: null,
      });
      if (t.startedAt) {
        out.push({
          encounterId, stage: 'diagnostic_execution', serviceId, referenceType: 'diagnostic_task', referenceId: t.taskId,
          enteredAt: t.startedAt, startedAt: t.startedAt, completedAt: t.completedAt,
        });
      }
    }

    // 6) Chờ bác sĩ đọc kết quả: xong toàn bộ cận lâm sàng -> kết luận chẩn đoán cuối (final)
    const orders = await this.prisma.diagnosticOrder.findMany({
      where: { completedAt: range },
      select: { orderId: true, encounterId: true, completedAt: true },
    });
    if (orders.length > 0) {
      const finals = await this.prisma.diagnosis.findMany({
        where: { encounterId: { in: [...new Set(orders.map((o) => o.encounterId))] }, diagnosisType: 'final' },
        select: { encounterId: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      for (const o of orders) {
        const concluded = finals.find((d) => d.encounterId === o.encounterId && d.createdAt >= o.completedAt!);
        out.push({
          encounterId: o.encounterId, stage: 'result_review', serviceId: null, referenceType: 'diagnostic_order', referenceId: o.orderId,
          enteredAt: o.completedAt!, startedAt: concluded?.createdAt ?? null, completedAt: null,
        });
      }
    }

    return out;
  }
}
