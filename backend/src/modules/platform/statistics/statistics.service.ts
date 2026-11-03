import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { compareQueueTickets, QueueTicketStatus } from '../../../common/constants/queue-ticket.constants';
import { STAGES, StageCode, WAIT_STAGE_TO_SERVICE_STAGE } from './statistics.constants';
import {
  addDays,
  enumerateDays,
  hospitalDateStrOf,
  hospitalDayBounds,
  hospitalHourOf,
  statDateOf,
  todayHospitalStr,
} from './statistics.util';

type Counter = Record<string, number>;

const countBy = <T>(rows: T[], key: (row: T) => string): Counter =>
  rows.reduce<Counter>((acc, r) => {
    const k = key(r);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

export interface EtaResult {
  stage: string;
  serviceStage: string;
  basis: 'hourly' | 'daily' | 'none';
  sampleCount: number;
  confidence: 'high' | 'medium' | 'low' | 'none';
  avgServiceSec: number | null;
  ahead: number;
  servers: number;
  /** null = chưa đủ dữ liệu lịch sử để ước lượng. */
  estimatedWaitSec: number | null;
}

/** SE07 — Thống kê & báo cáo: khối lượng khám, doanh thu, thời gian chờ/xử lý từng chặng, dashboard vận hành, ETA. */
@Injectable()
export class StatisticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) { }

  // ------------------------------------------------------------------ Báo cáo tổng quan

  async overview(from: string, to: string) {
    const days = enumerateDays(from, to);
    const start = hospitalDayBounds(from).start;
    const end = hospitalDayBounds(to).end;
    const instant = { gte: start, lt: end };
    const dateRange = { gte: statDateOf(from), lte: statDateOf(to) };

    const [appointments, encounters, payments, tasks, notifications] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { appointmentDate: dateRange },
        select: { status: true, bookingChannel: true, appointmentType: true },
      }),
      this.prisma.encounter.findMany({
        where: { arrivedAt: instant },
        select: { status: true, patientType: true, arrivedAt: true },
      }),
      this.prisma.payment.groupBy({
        by: ['paymentMethod'],
        where: { status: 'success', paidAt: instant },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.diagnosticTask.findMany({
        where: { status: 'completed', completedAt: instant },
        select: { orderItem: { select: { service: { select: { modality: true } } } } },
      }),
      this.prisma.notification.groupBy({
        by: ['channel', 'status'],
        where: { createdAt: instant },
        _count: { _all: true },
      }),
    ]);

    const daily = countBy(encounters, (e) => hospitalDateStrOf(e.arrivedAt));
    const revenueByMethod: Record<string, { amount: number; count: number }> = {};
    let revenueTotal = 0;
    for (const p of payments) {
      const amount = Number(p._sum.amount ?? 0);
      revenueByMethod[p.paymentMethod] = { amount, count: p._count._all };
      revenueTotal += amount;
    }

    return {
      range: { from, to, days: days.length },
      appointments: {
        total: appointments.length,
        byStatus: countBy(appointments, (a) => a.status),
        byBookingChannel: countBy(appointments, (a) => a.bookingChannel),
        byType: countBy(appointments, (a) => a.appointmentType),
      },
      encounters: {
        total: encounters.length,
        finished: encounters.filter((e) => e.status === 'finished').length,
        byStatus: countBy(encounters, (e) => e.status),
        byPatientType: countBy(encounters, (e) => e.patientType),
        dailyVolume: days.map((date) => ({ date, count: daily[date] ?? 0 })),
      },
      revenue: { currency: 'VND', total: revenueTotal, byMethod: revenueByMethod },
      diagnostics: {
        completedTasks: tasks.length,
        byModality: countBy(tasks, (t) => t.orderItem.service.modality),
      },
      notifications: notifications.map((n) => ({ channel: n.channel, status: n.status, count: n._count._all })),
    };
  }

  // ------------------------------------------------------------------ Thời gian chờ / xử lý theo chặng (từ rollup)

  async stages(from: string, to: string, stage?: string, serviceId?: string) {
    enumerateDays(from, to);
    const rows = await this.prisma.stageStatistic.findMany({
      where: {
        statDate: { gte: statDateOf(from), lte: statDateOf(to) },
        hourOfDay: null,
        ...(stage ? { stage } : {}),
        ...(serviceId ? { serviceId } : {}),
      },
      orderBy: [{ stage: 'asc' }, { statDate: 'asc' }],
    });

    const summary = STAGES.map((code) => {
      const r = rows.filter((x) => x.stage === code);
      const weighted = (pick: (x: (typeof rows)[number]) => number | null) => {
        let num = 0;
        let den = 0;
        for (const x of r) {
          const v = pick(x);
          if (v !== null) {
            num += v * x.sampleCount;
            den += x.sampleCount;
          }
        }
        return den ? Math.round(num / den) : null;
      };
      const worst = (pick: (x: (typeof rows)[number]) => number | null) => {
        const vals = r.map(pick).filter((v): v is number => v !== null);
        return vals.length ? Math.max(...vals) : null;
      };
      return {
        stage: code,
        sampleCount: r.reduce((s, x) => s + x.sampleCount, 0),
        avgWaitSec: weighted((x) => x.avgWaitSec),
        avgProcessSec: weighted((x) => x.avgProcessSec),
        // p90 của từng ngày không gộp được chính xác -> báo ngày tệ nhất thay vì giả vờ tính p90 toàn kỳ.
        p90WaitSecWorstDay: worst((x) => x.p90WaitSec),
        p90ProcessSecWorstDay: worst((x) => x.p90ProcessSec),
      };
    }).filter((s) => s.sampleCount > 0);

    return {
      range: { from, to },
      summary,
      daily: rows.map((x) => ({
        date: x.statDate.toISOString().slice(0, 10),
        stage: x.stage,
        serviceId: x.serviceId,
        sampleCount: x.sampleCount,
        avgWaitSec: x.avgWaitSec,
        p90WaitSec: x.p90WaitSec,
        avgProcessSec: x.avgProcessSec,
        p90ProcessSec: x.p90ProcessSec,
      })),
    };
  }

  // ------------------------------------------------------------------ Dashboard vận hành (hôm nay)

  async dashboard() {
    const today = todayHospitalStr();
    const { start, end } = hospitalDayBounds(today);
    const todayDate = statDateOf(today);

    const [tickets, triage, doctorQueue, activeTasks, encounters, todayStats] = await Promise.all([
      this.prisma.queueTicket.groupBy({ by: ['status'], where: { ticketDate: todayDate }, _count: { _all: true } }),
      this.prisma.triageQueueEntry.groupBy({ by: ['status'], where: { triageQueueDate: todayDate }, _count: { _all: true } }),
      this.prisma.doctorQueueEntry.groupBy({
        by: ['doctorId', 'status'],
        where: { doctorQueueDate: todayDate },
        _count: { _all: true },
      }),
      this.prisma.diagnosticTask.groupBy({
        by: ['diagnosticRoomId', 'status'],
        where: { status: { in: ['payment_pending', 'ready', 'in_progress', 'on_hold'] } },
        _count: { _all: true },
      }),
      this.prisma.encounter.groupBy({
        by: ['status'],
        where: { arrivedAt: { gte: start, lt: end } },
        _count: { _all: true },
      }),
      this.prisma.stageStatistic.findMany({ where: { statDate: todayDate, hourOfDay: null }, orderBy: { stage: 'asc' } }),
    ]);

    const toCounter = <T extends { status: string; _count: { _all: number } }>(rows: T[]): Counter =>
      rows.reduce<Counter>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + r._count._all }), {});

    return {
      date: today,
      generatedAt: new Date().toISOString(),
      receptionQueue: toCounter(tickets),
      triageQueue: toCounter(triage),
      doctorQueue: doctorQueue.map((d) => ({ doctorId: d.doctorId, status: d.status, count: d._count._all })),
      diagnosticBacklog: activeTasks.map((t) => ({ diagnosticRoomId: t.diagnosticRoomId, status: t.status, count: t._count._all })),
      encountersByStatus: toCounter(encounters),
      stageTimesToday: todayStats.map((s) => ({
        stage: s.stage,
        serviceId: s.serviceId,
        sampleCount: s.sampleCount,
        avgWaitSec: s.avgWaitSec,
        p90WaitSec: s.p90WaitSec,
        avgProcessSec: s.avgProcessSec,
        p90ProcessSec: s.p90ProcessSec,
        computedAt: s.computedAt,
      })),
    };
  }

  // ------------------------------------------------------------------ ETA

  async estimateWait(stage: string, opts: { serviceId?: string; ahead?: number; servers?: number } = {}): Promise<EtaResult> {
    const serviceStage = WAIT_STAGE_TO_SERVICE_STAGE[stage as StageCode];
    if (!serviceStage) {
      throw new BadRequestException(`stage '${stage}' không hỗ trợ ước lượng chờ`);
    }
    const ahead = opts.ahead ?? 0;
    const servers = Math.max(1, opts.servers ?? 1);
    const lookback = Number(this.config.get<string>('STATISTICS_ETA_LOOKBACK_DAYS') ?? 14);
    const since = statDateOf(addDays(todayHospitalStr(), -lookback));

    const base: Prisma.StageStatisticWhereInput = {
      stage: serviceStage,
      statDate: { gte: since },
      avgProcessSec: { not: null },
      ...(opts.serviceId ? { serviceId: opts.serviceId } : {}),
    };
    const hour = hospitalHourOf(new Date());
    const [hourly, daily] = await Promise.all([
      this.prisma.stageStatistic.findMany({ where: { ...base, hourOfDay: hour } }),
      this.prisma.stageStatistic.findMany({ where: { ...base, hourOfDay: null } }),
    ]);

    const weightedAvg = (rows: typeof hourly) => {
      const n = rows.reduce((s, r) => s + r.sampleCount, 0);
      const sum = rows.reduce((s, r) => s + (r.avgProcessSec ?? 0) * r.sampleCount, 0);
      return { n, avg: n ? Math.round(sum / n) : null };
    };
    const h = weightedAvg(hourly);
    const d = weightedAvg(daily);

    // Khung giờ hiện tại đủ mẫu (>=5) thì dùng, không thì lùi về trung bình cả ngày.
    const chosen = h.n >= 5 ? { basis: 'hourly' as const, ...h } : d.n >= 1 ? { basis: 'daily' as const, ...d } : null;
    if (!chosen || chosen.avg === null) {
      return { stage, serviceStage, basis: 'none', sampleCount: 0, confidence: 'none', avgServiceSec: null, ahead, servers, estimatedWaitSec: null };
    }
    return {
      stage,
      serviceStage,
      basis: chosen.basis,
      sampleCount: chosen.n,
      confidence: chosen.n >= 30 ? 'high' : chosen.n >= 10 ? 'medium' : 'low',
      avgServiceSec: chosen.avg,
      ahead,
      servers,
      estimatedWaitSec: Math.ceil(ahead / servers) * chosen.avg,
    };
  }

  /** ETA cho 1 số thứ tự đang chờ ở quầy tiếp đón: số người đứng trước tính theo ĐÚNG thứ tự ưu tiên gọi số. */
  async estimateForQueueTicket(ticketId: string) {
    const ticket = await this.prisma.queueTicket.findUnique({ where: { ticketId } });
    if (!ticket) throw new NotFoundException('Không tìm thấy số thứ tự');

    const label = `${ticket.ticketPrefix}${String(ticket.ticketNumber).padStart(3, '0')}`;
    if (ticket.status !== QueueTicketStatus.WAITING) {
      return { ticketId, ticketLabel: label, status: ticket.status, ahead: 0, estimatedWaitSec: 0 };
    }

    const [waiting, counterRows] = await Promise.all([
      this.prisma.queueTicket.findMany({
        where: { ticketDate: ticket.ticketDate, status: QueueTicketStatus.WAITING },
        include: { appointment: { select: { priority: true } } },
      }),
      this.prisma.queueTicket.findMany({
        where: { ticketDate: ticket.ticketDate, counterNumber: { not: null } },
        select: { counterNumber: true },
        distinct: ['counterNumber'],
      }),
    ]);
    const ordered = [...waiting].sort(compareQueueTickets);
    const ahead = Math.max(0, ordered.findIndex((t) => t.ticketId === ticketId));
    const eta = await this.estimateWait('reception_queue', { ahead, servers: Math.max(1, counterRows.length) });

    return { ticketId, ticketLabel: label, status: ticket.status, ...eta };
  }
}
