import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { LabTaskService } from '../lab-task.service';
import { OrderItemCancelledEvent, ORDER_ITEM_CANCELLED_EVENT } from '../events/order-item-cancelled.event';

/**
 * Lắng nghe 'order-item.cancelled' (phát bởi module Order khi bác sĩ chính thức huỷ chỉ định) và
 * cascade xuống LabTask tương ứng. Đây là hướng phụ thuộc DUY NHẤT dẫn tới trạng thái 'cancelled' —
 * phòng Lab không tự khởi tạo việc huỷ.
 *
 * TODO: khi module Order được triển khai thực tế, đảm bảo nó thực sự emit đúng tên event
 * ORDER_ITEM_CANCELLED_EVENT với đúng payload OrderItemCancelledEvent khai báo ở
 * `../events/order-item-cancelled.event.ts`.
 */
@Injectable()
export class LabTaskOrderCancellationListener {
    private readonly logger = new Logger(LabTaskOrderCancellationListener.name);

    constructor(private readonly labTaskService: LabTaskService) {}

    @OnEvent(ORDER_ITEM_CANCELLED_EVENT, { async: true })
    async handleOrderItemCancelled(event: OrderItemCancelledEvent): Promise<void> {
        try {
            await this.labTaskService.applyCancellationFromOrder(
                event.orderItemId,
                event.cancelledByUserId,
                event.reason,
            );
        } catch (err) {
            this.logger.error(
                `Cascade huỷ LabTask cho order item ${event.orderItemId} thất bại: ${(err as Error).message}`,
                (err as Error).stack,
            );
        }
    }
}
