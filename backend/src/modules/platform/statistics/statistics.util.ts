import { BadRequestException } from '@nestjs/common';
import { HOSPITAL_UTC_OFFSET_MS, MAX_RANGE_DAYS } from './statistics.constants';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export function assertDateString(value: string, field: string): void {
  if (!DATE_RE.test(value) || Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())) {
    throw new BadRequestException(`${field} phải có dạng YYYY-MM-DD`);
  }
}

/** [start, end) của 1 ngày theo giờ bệnh viện (UTC+7), trả về dạng Date UTC tuyệt đối. */
export function hospitalDayBounds(dateStr: string): { start: Date; end: Date } {
  const startUtcMidnight = new Date(`${dateStr}T00:00:00.000Z`).getTime();
  const start = new Date(startUtcMidnight - HOSPITAL_UTC_OFFSET_MS);
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** Giá trị cho cột @db.Date (00:00 UTC của ngày đó). */
export function statDateOf(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export function todayHospitalStr(now: Date = new Date()): string {
  return new Date(now.getTime() + HOSPITAL_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

export function hospitalDateStrOf(date: Date): string {
  return new Date(date.getTime() + HOSPITAL_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

export function hospitalHourOf(date: Date): number {
  return new Date(date.getTime() + HOSPITAL_UTC_OFFSET_MS).getUTCHours();
}

export function addDays(dateStr: string, days: number): string {
  return new Date(statDateOf(dateStr).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export function enumerateDays(from: string, to: string): string[] {
  assertDateString(from, 'from');
  assertDateString(to, 'to');
  if (from > to) throw new BadRequestException('from phải nhỏ hơn hoặc bằng to');
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.push(d);
    if (days.length > MAX_RANGE_DAYS) {
      throw new BadRequestException(`Khoảng ngày tối đa ${MAX_RANGE_DAYS} ngày`);
    }
  }
  return days;
}

/** Percentile theo nearest-rank trên mảng bất kỳ (không mutate). */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((s, v) => s + v, 0) / values.length);
}

export function secondsBetween(from: Date | null | undefined, to: Date | null | undefined): number | null {
  if (!from || !to) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
}
