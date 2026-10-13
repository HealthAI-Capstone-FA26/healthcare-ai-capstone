import { Injectable, Logger } from '@nestjs/common';
import {
    NotificationChannel,
    NotificationChannelStrategy,
    NotificationPayload,
} from './notification-channel.interface';
import { EmailNotificationStrategy } from './strategies/email-notification.strategy';
import { InAppNotificationStrategy } from './strategies/in-app-notification.strategy';

/**
 * Điều phối gửi thông báo qua nhiều kênh (Strategy pattern) — cùng thiết kế đã dùng ở
 * lab-test/notification/notification-dispatcher.service.ts, chỉ khác domain thanh toán hiện
 * chỉ cần 2 kênh 'email' + 'in_app' (§0, §1), không có 'push'.
 *
 * Các kênh chạy song song và ĐỘC LẬP — 1 kênh lỗi (VD: gửi email thất bại) chỉ được log lại,
 * không throw ra ngoài, để không chặn kênh còn lại hay làm fail luồng nghiệp vụ gọi dispatch()
 * (VD: InvoiceService.generate()/markPaidIfSettled() không nên fail chỉ vì gửi email lỗi).
 */
@Injectable()
export class NotificationDispatcherService {
    private readonly logger = new Logger(NotificationDispatcherService.name);
    private readonly strategiesByPriority: NotificationChannelStrategy[];

    constructor(
        private readonly emailStrategy: EmailNotificationStrategy,
        private readonly inAppStrategy: InAppNotificationStrategy,
    ) {
        this.strategiesByPriority = [this.inAppStrategy, this.emailStrategy];
    }

    /**
     * Gửi 1 thông báo qua các kênh chỉ định. Không truyền `channels` -> gửi qua TẤT CẢ
     * (email + in_app).
     */
    async dispatch(payload: NotificationPayload, channels?: NotificationChannel[]): Promise<void> {
        const targets = channels
            ? this.strategiesByPriority.filter((s) => channels.includes(s.channel))
            : this.strategiesByPriority;

        await Promise.all(
            targets.map(async (strategy) => {
                try {
                    await strategy.send(payload);
                } catch (err) {
                    const error = err as Error;
                    this.logger.error(
                        `Gửi thông báo kênh '${strategy.channel}' thất bại ` +
                        `(notificationType=${payload.notificationType}, referenceId=${payload.referenceId}): ${error?.message}`,
                        error?.stack,
                    );
                }
            }),
        );
    }
}
