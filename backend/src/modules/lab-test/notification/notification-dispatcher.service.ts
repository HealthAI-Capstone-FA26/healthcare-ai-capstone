import { Injectable, Logger } from '@nestjs/common';
import {
    NotificationChannel,
    NotificationChannelStrategy,
    NotificationPayload,
} from './notification-channel.interface';
import { EmailNotificationStrategy } from './strategies/email-notification.strategy';
import { InAppNotificationStrategy } from './strategies/in-app-notification.strategy';
import { PushNotificationStrategy } from './strategies/push-notification.strategy';

/**
 * Điều phối gửi thông báo qua nhiều kênh (Strategy pattern) — thay cho việc gọi thẳng
 * Dispatcher không biết chi tiết cách từng kênh gửi, chỉ biết
 * gọi `strategy.send()`.
 *
 * Thứ tự ưu tiên hiện tại: EMAIL và IN_APP được triển khai đầy đủ, luôn được ưu tiên gửi.
 * PUSH là kênh bổ sung, ưu tiên thấp hơn (PushSenderPort hiện là stub — xem push-sender.port.ts).
 *
 * Các kênh chạy song song và ĐỘC LẬP — 1 kênh lỗi (VD: gửi email thất bại) chỉ được log lại,
 * không throw ra ngoài, để không chặn các kênh còn lại hoặc làm fail luồng nghiệp vụ gọi dispatch()
 * (VD: LabCompletionNotificationService không nên fail toàn bộ chỉ vì gửi email lỗi).
 */
@Injectable()
export class NotificationDispatcherService {
    private readonly logger = new Logger(NotificationDispatcherService.name);
    private readonly strategiesByPriority: NotificationChannelStrategy[];

    constructor(
        private readonly emailStrategy: EmailNotificationStrategy,
        private readonly inAppStrategy: InAppNotificationStrategy,
        private readonly pushStrategy: PushNotificationStrategy,
    ) {
        this.strategiesByPriority = [this.inAppStrategy, this.emailStrategy, this.pushStrategy];
    }

    /**
     * Gửi 1 thông báo qua các kênh chỉ định. Không truyền `channels` -> gửi qua TẤT CẢ
     * (email + in_app + push).
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
