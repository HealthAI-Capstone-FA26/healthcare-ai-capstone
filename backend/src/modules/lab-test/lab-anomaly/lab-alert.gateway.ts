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
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { ActorRoleService } from '../../identity-access/user/actor-role.service';
import { ACTOR_ROLE, ActorRole } from '../../../common/constants/actor-role.constant';
import { LabDetectionResult } from './interfaces/lab-result-detector.interface';

export interface LabAlertPushPayload {
    labResultId: string;
    encounterId: string;
    totalValues: number;
    abnormalCount: number;
    results: LabDetectionResult[];
}

/**
 * Gateway realtime cho cảnh báo chỉ số cận lâm sàng nguy hiểm.
 * Client (màn hình theo dõi của bác sĩ/điều dưỡng) join room theo encounterId,
 * server push alert ngay khi detection chạy xong ở background.
 * Namespace riêng '/lab-alerts' để tách khỏi '/vital-alerts' và các socket khác.
 */
export interface EcgAlertPushPayload {
    ecgRecordingId: string;
    /** Alias của ecgRecordingId — FE (EcgAlertSocketPayload) đọc `recordingId`. */
    recordingId: string;
    analysisId: string;
    encounterId: string;
    /** queued | running | completed | failed | skipped */
    status: string;
    overallResult: string | null;
    anomalyCount: number;
    /** mức nghiêm trọng cao nhất trong các sự kiện (null nếu không có) */
    maxSeverity: string | null;
    errorCode: string | null;
}

/**
 * CORS: đặt LAB_ALERT_CORS_ORIGINS (danh sách origin, phân tách bằng dấu phẩy). Không đặt: môi trường dev cho phép
 * mọi origin, production từ chối cross-origin (origin: false).
 */
const LAB_ALERT_CORS_ORIGIN: string[] | string | boolean = process.env.LAB_ALERT_CORS_ORIGINS
    ? process.env.LAB_ALERT_CORS_ORIGINS.split(',').map((o) => o.trim())
    : process.env.NODE_ENV === 'production'
        ? false
        : '*';

/** Vai trò được nghe cảnh báo cận lâm sàng (bệnh nhân/lễ tân không có quyền xem ECG của lượt khám). */
const SUBSCRIBE_ROLES: ActorRole[] = [ACTOR_ROLE.DOCTOR, ACTOR_ROLE.LAB_STAFF, ACTOR_ROLE.NURSE, ACTOR_ROLE.ADMIN];

/** Mặc định BẮT BUỘC JWT khi kết nối (dữ liệu bệnh nhân). Đặt LAB_ALERT_REQUIRE_AUTH=false để tắt (chỉ dev). */
const requireAuth = (): boolean => process.env.LAB_ALERT_REQUIRE_AUTH !== 'false';

const isValidId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;

@WebSocketGateway({
    namespace: 'lab-alerts',
    cors: { origin: LAB_ALERT_CORS_ORIGIN },
})
export class LabAlertGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(LabAlertGateway.name);

    @WebSocketServer()
    server: Server;

    constructor(
        private readonly jwtService: JwtService,
        private readonly actorRoleService: ActorRoleService,
    ) { }

    /**
     * Xác thực khi bắt tay: FE gửi `auth: { token }` (hoặc header Authorization: Bearer). Token sai/hết hạn -> ngắt kết nối.
     * Không xác thực lại khi socket đã mở (token hết hạn sau đó không làm rớt kết nối đang chạy).
     */
    async handleConnection(client: Socket) {
        if (!requireAuth()) {
            this.logger.log(`Client connected (auth off): ${client.id}`);
            return;
        }
        const token = this.extractToken(client);
        try {
            if (!token) throw new Error('missing token');
            const payload = await this.jwtService.verifyAsync<{ sub: string }>(token);
            client.data.userId = payload.sub;
            this.logger.log(`Client connected: ${client.id} (user ${payload.sub})`);
        } catch {
            this.logger.warn(`Từ chối kết nối ${client.id}: token thiếu hoặc không hợp lệ`);
            client.emit('unauthorized', { message: 'Token thiếu hoặc không hợp lệ' });
            client.disconnect(true);
        }
    }

    private extractToken(client: Socket): string | null {
        const authToken: unknown = client.handshake.auth?.token;
        if (typeof authToken === 'string' && authToken) return authToken.replace(/^Bearer\s+/i, '');
        const header = client.handshake.headers.authorization;
        return typeof header === 'string' && /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '') : null;
    }

    handleDisconnect(client: Socket) {
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    @SubscribeMessage('subscribe')
    async handleSubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { encounterId?: string }) {
        if (!isValidId(body?.encounterId)) return { status: 'error', message: 'encounterId không hợp lệ' };

        const userId: string | undefined = client.data.userId;
        if (requireAuth()) {
            if (!userId) return { status: 'forbidden' };
            try {
                await this.actorRoleService.assertActorRole(userId, SUBSCRIBE_ROLES);
            } catch {
                this.logger.warn(`User ${userId} không có quyền subscribe encounter ${body.encounterId}`);
                return { status: 'forbidden' };
            }
        }

        const room = this.roomName(body.encounterId);
        await client.join(room);
        this.logger.log(`Client ${client.id} subscribed to ${room}`);
        return { status: 'subscribed', encounterId: body.encounterId };
    }

    @SubscribeMessage('unsubscribe')
    handleUnsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { encounterId?: string }) {
        if (!isValidId(body?.encounterId)) return { status: 'error', message: 'encounterId không hợp lệ' };
        void client.leave(this.roomName(body.encounterId));
        return { status: 'unsubscribed', encounterId: body.encounterId };
    }

    pushAlertUpdate(payload: LabAlertPushPayload) {
        const room = this.roomName(payload.encounterId);
        this.server.to(room).emit('lab-alert-update', payload);
    }

    /** Cùng room encounter:{id} với cảnh báo chỉ số — FE chỉ cần subscribe 1 lần. */
    pushEcgAlertUpdate(payload: EcgAlertPushPayload) {
        const room = this.roomName(payload.encounterId);
        this.server.to(room).emit('ecg-alert-update', payload);
    }

    private roomName(encounterId: string): string {
        return `encounter:${encounterId}`;
    }
}
