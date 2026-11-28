import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { RedisService } from '../../../redis/redis.service';
import { PaymentService } from './payment.service';

const RECONCILE_LOCK_KEY = 'payment-reconciliation:payos';
const RECONCILE_LOCK_TTL_SECONDS = 4 * 60;

/**
 * Chạy định kỳ mỗi 5 phút để đối soát các giao dịch PayOS còn 'pending' (phòng webhook bị mất/trễ)
 * và tự phục hồi các hoá đơn bị kẹt 'pending' dù đã có Payment 'success'.
 */
@Injectable()
export class PaymentReconciliationCron {
  private readonly logger = new Logger(PaymentReconciliationCron.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly paymentService: PaymentService,
  ) {}

  @Cron('*/5 * * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
  async handleCron() {
    const token = await this.redisService.acquireLock(
      RECONCILE_LOCK_KEY,
      RECONCILE_LOCK_TTL_SECONDS,
    );
    if (!token) {
      return;
    }

    try {
      await this.paymentService.reconcilePendingPayments();
    } catch (err) {
      this.logger.error(
        `Lỗi khi chạy cron đối soát thanh toán PayOS: ${(err as Error)?.message}`,
      );
    } finally {
      await this.redisService.releaseLock(RECONCILE_LOCK_KEY, token);
    }
  }
}
