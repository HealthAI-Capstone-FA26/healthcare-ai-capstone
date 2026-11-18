import {
    WebSocketGateway,
    WebSocketServer,
    SubscribeMessage,
    MessageBody,
    ConnectedSocket,
    OnGatewayConnection,
    OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { DetectionResult } from './vital-sign-detector.interface';

export interface VitalAlertPushPayload {
    vitalSessionId: string;
    encounterId: string;
    totalObservations: number;
    abnormalCount: number;
    results: DetectionResult[];
}

/**
 * Gateway realtime cho vital sign alerts.
 * Client (màn hình theo dõi bệnh nhân của điều dưỡng/bác sĩ) join room theo encounterId,
 * server sẽ push alert mới ngay khi detection (rule/ai) chạy xong ở background.
 *
 * Namespace riêng '/vital-alerts' để tách khỏi các socket khác trong app (nếu có).
 */
@WebSocketGateway({
    namespace: 'vital-alerts',
    cors: { origin: '*' }, // TODO: giới hạn origin theo domain thật khi lên production
})
export class VitalAlertGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(VitalAlertGateway.name);

    @WebSocketServer()
    server: Server;

    handleConnection(client: Socket) {
        this.logger.log(`Client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    /**
     * Client emit 'subscribe' kèm encounterId để join room theo dõi encounter đó.
     * VD (client): socket.emit('subscribe', { encounterId: '...' })
     */
    @SubscribeMessage('subscribe')
    handleSubscribe(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { encounterId: string },
    ) {
        const room = this.roomName(body.encounterId);
        client.join(room);
        this.logger.log(`Client ${client.id} subscribed to ${room}`);
        return { status: 'subscribed', encounterId: body.encounterId };
    }

    @SubscribeMessage('unsubscribe')
    handleUnsubscribe(
        @ConnectedSocket() client: Socket,
        @MessageBody() body: { encounterId: string },
    ) {
        const room = this.roomName(body.encounterId);
        client.leave(room);
        return { status: 'unsubscribed', encounterId: body.encounterId };
    }

    /**
     * Được gọi từ VitalSignDetectionListener sau khi orchestrator chạy xong.
     * Push tới mọi client đang subscribe encounterId tương ứng.
     */
    pushAlertUpdate(payload: VitalAlertPushPayload) {
        const room = this.roomName(payload.encounterId);
        this.server.to(room).emit('vital-alert-update', payload);
    }

    private roomName(encounterId: string): string {
        return `encounter:${encounterId}`;
    }
}
