import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannelStrategy, NotificationPayload } from './notification-channel.interface';
import { EmailNotificationStrategy } from './strategies/email-notification.strategy';
import { InAppNotificationStrategy } from './strategies/in-app-notification.strategy';

@Injectable()
export class NotificationDispatcherService {
    private readonly logger = new Logger(NotificationDispatcherService.name);
    private readonly strategies: NotificationChannelStrategy[];

    constructor(
        private readonly emailStrategy: EmailNotificationStrategy,
        private readonly inAppStrategy: InAppNotificationStrategy,
    ) {
        this.strategies = [this.emailStrategy, this.inAppStrategy];
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
