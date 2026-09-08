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
import { LabDetectionResult } from './interfaces/lab-result-detector.interface';

export interface LabAlertPushPayload {
    labResultId: string;
    encounterId: string;
    totalValues: number;
    abnormalCount: number;
    results: LabDetectionResult[];
}

/**
 * Gateway realtime cho cảnh báo chỉ số xét nghiệm nguy hiểm.
 * Client (màn hình theo dõi của bác sĩ/điều dưỡng) join room theo encounterId,
 * server push alert ngay khi detection chạy xong ở background.
 * Namespace riêng '/lab-alerts' để tách khỏi '/vital-alerts' và các socket khác.
 */
@WebSocketGateway({
    namespace: 'lab-alerts',
    cors: { origin: '*' }, // TODO: giới hạn origin theo domain thật khi lên production
})
export class LabAlertGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(LabAlertGateway.name);

    @WebSocketServer()
    server: Server;

    handleConnection(client: Socket) {
        this.logger.log(`Client connected: ${client.id}`);
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    @SubscribeMessage('subscribe')
    handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { encounterId: string }) {
        const room = this.roomName(body.encounterId);
        client.join(room);
        this.logger.log(`Client ${client.id} subscribed to ${room}`);
        return { status: 'subscribed', encounterId: body.encounterId };
    }

    @SubscribeMessage('unsubscribe')
    handleUnsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { encounterId: string }) {
        const room = this.roomName(body.encounterId);
        client.leave(room);
        return { status: 'unsubscribed', encounterId: body.encounterId };
    }

    pushAlertUpdate(payload: LabAlertPushPayload) {
        const room = this.roomName(payload.encounterId);
        this.server.to(room).emit('lab-alert-update', payload);
    }

    private roomName(encounterId: string): string {
        return `encounter:${encounterId}`;
    }
}
