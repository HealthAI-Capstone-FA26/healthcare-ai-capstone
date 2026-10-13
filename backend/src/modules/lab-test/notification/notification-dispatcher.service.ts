import { Injectable, Logger } from '@nestjs/common';
import {
    NotificationChannel,
    NotificationChannelStrategy,
    NotificationPayload,
} from './notification-channel.interface';
import { EmailNotificationStrategy } from './strategies/email-notification.strategy';
import { InAppNotificationStrategy } from './strategies/in-app-notification.strategy';
import { SmsNotificationStrategy, ZaloOaNotificationStrategy } from './strategies/queued-notification.strategy';

/**
 * Điều phối gửi thông báo qua nhiều kênh (Strategy pattern). Dispatcher chỉ gọi `strategy.send()`.
 *
 *  - in_app : ghi Notification 'sent' ngay.
 *  - email  : gửi qua EmailSenderPort rồi ghi Notification ('sent' | 'failed').
 *  - sms / zalo_oa : ghi Notification 'queued' cho worker SE07 gửi.
 *
 * Các kênh chạy song song và ĐỘC LẬP — 1 kênh lỗi chỉ được log, không throw, để không chặn kênh khác hoặc làm
 * fail luồng nghiệp vụ gọi dispatch().
 */
@Injectable()
export class NotificationDispatcherService {
    private readonly logger = new Logger(NotificationDispatcherService.name);
    private readonly strategies: NotificationChannelStrategy[];

    constructor(
        inAppStrategy: InAppNotificationStrategy,
        emailStrategy: EmailNotificationStrategy,
        smsStrategy: SmsNotificationStrategy,
        zaloOaStrategy: ZaloOaNotificationStrategy,
    ) {
        this.strategies = [inAppStrategy, emailStrategy, smsStrategy, zaloOaStrategy];
    }

    /** Không truyền `channels` -> gửi qua TẤT CẢ kênh. */
    async dispatch(payload: NotificationPayload, channels?: NotificationChannel[]): Promise<void> {
        const targets = channels ? this.strategies.filter((s) => channels.includes(s.channel)) : this.strategies;

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
