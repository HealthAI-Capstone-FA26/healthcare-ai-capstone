import { Injectable } from '@nestjs/common';
import { DoctorSchedule, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class AppointmentSlotService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sinh toàn bộ AppointmentSlot cho 1 DoctorSchedule vừa tạo, chia đều theo slotDurationMins
   * từ startTime -> endTime. capacity mỗi slot = maxPatientsPerSlot của schedule.
   * PHẢI chạy trong cùng transaction với việc tạo DoctorSchedule (nhận `tx` từ nơi gọi).
   */
  async generateSlotsForSchedule(
    tx: Prisma.TransactionClient,
    schedule: DoctorSchedule,
  ): Promise<number> {
    const slotsData: Prisma.AppointmentSlotCreateManyInput[] = [];

    // Ghép workDate + giờ bắt đầu/kết thúc của ca làm việc để lấy mốc thời gian thực tế trong ngày.
    const startMs = combineDateWithTimeOfDay(schedule.workDate, schedule.startTime).getTime();
    const endMs = combineDateWithTimeOfDay(schedule.workDate, schedule.endTime).getTime();
    // Quy đổi độ dài 1 slot từ phút sang milliseconds.
    const stepMs = schedule.slotDurationMins * 60 * 1000;

    // Sinh các slot liên tiếp [start, end) theo bước stepMs.
    // Điều kiện cursor + stepMs <= endMs giúp slot cuối không vượt quá giờ kết thúc ca.
    for (let cursor = startMs; cursor + stepMs <= endMs; cursor += stepMs) {
      slotsData.push({
        scheduleId: schedule.scheduleId,
        slotStartTime: new Date(cursor),
        slotEndTime: new Date(cursor + stepMs),
        capacity: schedule.maxPatientsPerSlot,
        bookedCount: 0,
        status: 'free',
      });
    }

    if (slotsData.length === 0) {
      return 0;
    }

    // Tạo hàng loạt trong cùng transaction để đảm bảo tính nhất quán với DoctorSchedule.
    const result = await tx.appointmentSlot.createMany({ data: slotsData });
    return result.count;
  }

  // GET /doctors/:id/slots?date= — chỉ trả slot còn free, dùng ở bước chọn slot (Phase 4)
  findFreeSlotsByDoctorAndDate(doctorId: string, date: string) {
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    return this.prisma.appointmentSlot.findMany({
      where: {
        status: 'free',
        schedule: {
          doctorId,
          workDate: dayStart,
        },
        slotStartTime: { gte: dayStart, lte: dayEnd },
      },
      orderBy: { slotStartTime: 'asc' },
    });
  }
}

// workDate (DateTime @db.Date) có phần giờ = 00:00 UTC; time (DateTime @db.Time) chỉ có phần giờ:phút
// có giá trị -> ghép lại thành 1 mốc thời gian thật cho slotStartTime/slotEndTime.
function combineDateWithTimeOfDay(workDate: Date, time: Date): Date {
  return new Date(
    Date.UTC(
      workDate.getUTCFullYear(),
      workDate.getUTCMonth(),
      workDate.getUTCDate(),
      time.getUTCHours(),
      time.getUTCMinutes(),
      0,
      0,
    ),
  );
}
