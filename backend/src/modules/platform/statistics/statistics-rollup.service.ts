import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { StageEventCollector, StageSample } from './stage-event.collector';
import { DERIVED_REFERENCE_TYPES, STAGE_KIND } from './statistics.constants';
import {
  addDays,
  average,
  enumerateDays,
  hospitalDayBounds,
  hospitalHourOf,
  percentile,
  secondsBetween,
  statDateOf,
  todayHospitalStr,
} from './statistics.util';

interface Durations {
  waitSec: number | null;
  processSec: number | null;
}

/** Tính waitSec/processSec theo loại chặng (xem STAGE_KIND). */
export function durationsOf(sample: StageSample): Durations {
  const kind = STAGE_KIND[sample.stage];
  return {
    waitSec: kind !== 'process' ? secondsBetween(sample.enteredAt, sample.startedAt) : null,
    processSec: kind !== 'wait' ? secondsBetween(sample.startedAt, sample.completedAt) : null,
  };
}

/**
 * Job tổng hợp thống kê SE07:
 *   collector -> EncounterStageEvent (dòng thời gian từng lượt khám, chỉ các chặng đã có Encounter)
 *             -> StageStatistic (rollup theo ngày & theo giờ, tính trên TẤT CẢ mẫu kể cả chưa có Encounter).
 * Idempotent: mỗi lần chạy xoá-rồi-ghi lại đúng phạm vi của ngày đó trong 1 transaction (không cần unique index thủ công
 * mà schema đã cảnh báo vì NULL không bị coi là trùng). Cron mỗi giờ tính lại hôm nay + hôm qua để bắt kịp chặng hoàn tất muộn.
 * Cấu hình: STATISTICS_ROLLUP_ENABLED=false để tắt cron (vd. chỉ chạy trên 1 instance).
 */
@Injectable()
export class StatisticsRollupService {
  private readonly logger = new Logger(StatisticsRollupService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly collector: StageEventCollector,
  ) { }

  @Cron(CronExpression.EVERY_HOUR)
  async hourlyRollup(): Promise<void> {
    if (this.config.get<string>('STATISTICS_ROLLUP_ENABLED') === 'false') return;
    if (this.running) return;
    this.running = true;
    try {
      const today = todayHospitalStr();
      await this.rollupRange(addDays(today, -1), today);
    } catch (err) {
      this.logger.error(`Rollup thống kê lỗi: ${(err as Error).message}`, (err as Error).stack);
    } finally {
      this.running = false;
    }
  }

  async rollupRange(from: string, to: string): Promise<{ days: number; events: number; statistics: number }> {
    let events = 0;
    let statistics = 0;
    const days = enumerateDays(from, to);
    for (const day of days) {
      const r = await this.rollupDay(day);
      events += r.events;
      statistics += r.statistics;
    }
    return { days: days.length, events, statistics };
  }

  async rollupDay(dateStr: string): Promise<{ events: number; statistics: number }> {
    const samples = await this.collector.collect(dateStr);
    const { start, end } = hospitalDayBounds(dateStr);

    const eventRows: Prisma.EncounterStageEventCreateManyInput[] = samples
      .filter((s) => s.encounterId)
      .map((s) => {
        const d = durationsOf(s);
        return {
          encounterId: s.encounterId!,
          stage: s.stage,
          serviceId: s.serviceId,
          referenceType: s.referenceType,
          referenceId: s.referenceId,
          enteredAt: s.enteredAt,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          waitSec: d.waitSec,
          processSec: d.processSec,
        };
      });

    const statRows = this.buildStatistics(dateStr, samples);

    await this.prisma.$transaction(async (tx) => {
      await tx.encounterStageEvent.deleteMany({
        where: { enteredAt: { gte: start, lt: end }, referenceType: { in: [...DERIVED_REFERENCE_TYPES] } },
      });
      if (eventRows.length) await tx.encounterStageEvent.createMany({ data: eventRows });

      await tx.stageStatistic.deleteMany({ where: { statDate: statDateOf(dateStr) } });
      if (statRows.length) await tx.stageStatistic.createMany({ data: statRows });
    });

    return { events: eventRows.length, statistics: statRows.length };
  }

  /** Nhóm theo (stage, serviceId, giờ) + cả ngày (hourOfDay = null). */
  private buildStatistics(dateStr: string, samples: StageSample[]): Prisma.StageStatisticCreateManyInput[] {
    interface Bucket { stage: string; serviceId: string | null; hour: number | null; waits: number[]; procs: number[]; count: number }
    const buckets = new Map<string, Bucket>();

    const add = (s: StageSample, hour: number | null, d: Durations) => {
      const key = `${s.stage}|${s.serviceId ?? ''}|${hour ?? 'all'}`;
      let b = buckets.get(key);
      if (!b) {
        b = { stage: s.stage, serviceId: s.serviceId, hour, waits: [], procs: [], count: 0 };
        buckets.set(key, b);
      }
      b.count += 1;
      if (d.waitSec !== null) b.waits.push(d.waitSec);
      if (d.processSec !== null) b.procs.push(d.processSec);
    };

    for (const s of samples) {
      const d = durationsOf(s);
      if (d.waitSec === null && d.processSec === null) continue; // chặng chưa hoàn tất -> chưa có số đo
      add(s, hospitalHourOf(s.enteredAt), d);
      add(s, null, d);
    }

    const statDate = statDateOf(dateStr);
    return [...buckets.values()].map((b) => ({
      statDate,
      hourOfDay: b.hour,
      stage: b.stage,
      serviceId: b.serviceId,
      sampleCount: b.count,
      avgWaitSec: average(b.waits),
      p90WaitSec: percentile(b.waits, 90),
      avgProcessSec: average(b.procs),
      p90ProcessSec: percentile(b.procs, 90),
    }));
  }
}
