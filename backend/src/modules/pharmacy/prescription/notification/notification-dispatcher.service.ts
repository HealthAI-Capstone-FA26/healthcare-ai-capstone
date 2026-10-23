import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannelStrategy, NotificationPayload } from './notification-channel.interface';
import { EmailNotificationStrategy } from './strategies/email-notification.strategy';
import { InAppNotificationStrategy } from './strategies/in-app-notification.strategy';
import {
    CentralSmsNotificationStrategy,
    CentralZaloOaNotificationStrategy,
} from '../../../platform/notification/strategies/queued-channel.strategies';

@Injectable()
export class NotificationDispatcherService {
    private readonly logger = new Logger(NotificationDispatcherService.name);
    private readonly strategies: NotificationChannelStrategy[];

    constructor(
        private readonly emailStrategy: EmailNotificationStrategy,
        private readonly inAppStrategy: InAppNotificationStrategy,
        // SMS / Zalo OA: strategy dùng chung từ NotificationModule (global) — chỉ ghi 'queued', worker SE07 gửi.
        private readonly smsStrategy: CentralSmsNotificationStrategy,
        private readonly zaloOaStrategy: CentralZaloOaNotificationStrategy,
    ) {
        this.strategies = [this.emailStrategy, this.inAppStrategy, this.smsStrategy, this.zaloOaStrategy];
    }

    async dispatch(payload: NotificationPayload): Promise<void> {
        await Promise.all(
            this.strategies.map(async (strategy) => {
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
