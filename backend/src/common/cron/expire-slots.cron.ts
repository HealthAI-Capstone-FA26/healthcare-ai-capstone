import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'prisma/prisma.service';
import { RedisService } from 'src/redis/redis.service';

const LOCK_TTL_SECONDS = 5 * 60;
const LOCK_KEY_PREFIX = 'expire-slots-gen';

/**
 * Chạy cuối ngày: slot còn status=free mà workDate đã qua -> chuyển status=cancelled.
 * Không đụng tới slot đã có appointment (status full/blocked không nằm trong điều kiện where).
 */
@Injectable()
export class ExpireSlotsCron {
  private readonly logger = new Logger(ExpireSlotsCron.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_11PM)
  async handleCron() {
    // Chuẩn hóa về đầu ngày để chỉ những lịch của các ngày trước mới hết hạn.
    const today = startOfUtcDay(new Date());
    const lockKey = `${LOCK_KEY_PREFIX}:${today.toISOString().slice(0, 10)}`;
    
    const token = await this.redisService.acquireLock(lockKey, LOCK_TTL_SECONDS);
    if (!token) {
      // Khi chạy nhiều instance backend, chỉ một instance được phép dọn dữ liệu.
      this.logger.log(`Bỏ qua chạy cron dọn slot: instance khác đang giữ lock "${lockKey}"`);
      return;
    }

    try {
      await this.run(today);
    } finally {
      await this.redisService.releaseLock(lockKey, token);
    }
  }

  async run(today: Date) {
    const result = await this.prisma.appointmentSlot.updateMany({
      where: {
        // Chỉ hủy slot chưa có bệnh nhân; slot đã đặt hoặc bị khóa được giữ nguyên.
        status: 'free',
        schedule: { workDate: { lt: today } },
      },
      data: { status: 'cancelled' },
    });

    this.logger.log(`Đã dọn ${result.count} slot free hết hạn (workDate < ${today.toISOString().slice(0, 10)})`);
    return { expiredCount: result.count };
  }
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
