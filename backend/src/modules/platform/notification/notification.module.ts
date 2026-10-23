import { Global, Module } from '@nestjs/common';
import { NotificationController } from './notification.controller';
import { NotificationService } from './notification.service';
import { NotificationWorkerService } from './notification-worker.service';
import { NotificationContactResolver } from './notification-contact.resolver';
import { ZaloOaSender } from './zalo-oa.sender';
import {
  CentralSmsNotificationStrategy,
  CentralZaloOaNotificationStrategy,
} from './strategies/queued-channel.strategies';

/**
 * SE07 — Thông báo đa kênh dùng chung. @Global: các module khác (payment, prescription, cron nhắc hẹn,
 * queue-ticket) inject NotificationService / strategy sms-zalo mà không cần import lại.
 * PrismaService (PrismaModule), MailService (MailModule), SmsService (SmsModule), ConfigService đều global sẵn.
 * Không phụ thuộc module nghiệp vụ nào -> không tạo vòng phụ thuộc.
 */
@Global()
@Module({
  controllers: [NotificationController],
  providers: [
    NotificationContactResolver,
    NotificationService,
    NotificationWorkerService,
    ZaloOaSender,
    CentralSmsNotificationStrategy,
    CentralZaloOaNotificationStrategy,
  ],
  exports: [
    NotificationService,
    NotificationContactResolver,
    CentralSmsNotificationStrategy,
    CentralZaloOaNotificationStrategy,
  ],
})
export class NotificationModule {}
