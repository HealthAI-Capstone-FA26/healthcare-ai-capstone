import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannelStrategy, NotificationPayload } from './notification-channel.interface';
import { EmailNotificationStrategy } from './strategies/email-notification.strategy';

/**
 * Điều phối gửi thông báo (Strategy pattern) — cùng thiết kế đã dùng ở
 * payment/notification/notification-dispatcher.service.ts, chỉ khác domain prescription
 * hiện chỉ cần kênh 'email' (Phase 6 kế hoạch module 9).
 *
 * Lỗi gửi chỉ được log lại, không throw ra ngoài, để không làm fail luồng nghiệp vụ gọi
 * dispatch() (VD: PrescriptionFollowupService không nên fail chỉ vì gửi email lỗi, lịch
 * tái khám đã tạo thành công vẫn phải trả về cho bác sĩ).
 */
@Injectable()
export class NotificationDispatcherService {
    private readonly logger = new Logger(NotificationDispatcherService.name);
    private readonly strategies: NotificationChannelStrategy[];

    constructor(private readonly emailStrategy: EmailNotificationStrategy) {
        this.strategies = [this.emailStrategy];
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
