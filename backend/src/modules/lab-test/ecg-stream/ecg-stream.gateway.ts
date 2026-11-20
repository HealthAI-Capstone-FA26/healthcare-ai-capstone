import { ConnectedSocket, MessageBody, OnGatewayConnection, OnGatewayDisconnect, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Socket } from 'socket.io';
import { ActorRoleService } from '../../identity-access/user/actor-role.service';
import { ACTOR_ROLE, ActorRole } from '../../../common/constants/actor-role.constant';
import { ECG_DATASET_NAMES, normalizeDatasetName } from './ecg-dataset.catalog';
import { EcgPlayback } from './ecg-playback';
import { EcgStreamError } from './ecg-stream.error';
import { getStreamMaxUploadBytes } from './ecg-stream.config';
import { ECG_STREAM_MAX_SPEED, ECG_STREAM_MIN_SPEED, ECG_UPLOAD_STREAM_FORMATS, EcgStreamService, EcgStreamSource } from './ecg-stream.service';

/**
 * Realtime stream từng điểm tín hiệu ECG — namespace '/ecg-stream' (tách khỏi '/lab-alerts' vì lưu lượng lớn:
 * 500 Hz = 500 message/giây/client).
 *
 * ── NGUỒN TÍN HIỆU (chọn ĐÚNG MỘT trong ba, dùng cho cả API [1] và [2]) ─────────────────────────────────────────
 *   file       Buffer/ArrayBuffer/Blob của tệp .npy hoặc .csv người dùng upload  (kèm fileName + sampleRateHz bắt buộc)
 *   dataset    'ECG_A' … 'ECG_F' — dataset có sẵn trên server (xem 'list-ecg-datasets')
 *   recordingId  bản ghi ECG đã lưu trong hệ thống (luồng cũ)
 *   Upload và dataset hoạt động y hệt nhau về mọi thứ phía sau (đọc tín hiệu, chọn lead, phát từng điểm).
 *
 * ── API [1]  stream-ecg ─────────────────────────────────────────────────────────────────────────────────────────
 *   client:  socket.emit('stream-ecg', { file, fileName, sampleRateHz, leadNames? | dataset | recordingId,
 *                                        lead?, speed?, startMs? }, ack)
 *   ack:     { status:'streaming', streamId, source, sourceName, lead, sampleRateHz, totalPoints, durationMs, speed, startMs, withAnomaly:false }
 *   server:  mỗi mẫu một message  'ecg-point'  { streamId, source, sourceName, lead, seq, tMs, value }
 *
 * ── API [2]  stream-ecg-anomaly (như [1] + nhãn anomaly) ─────────────────────────────────────────────────────────
 *   client:  socket.emit('stream-ecg-anomaly', { …như [1], analysisId? (chỉ với recordingId) }, ack)
 *   Backend gọi dịch vụ AI phân tích tệp (upload/dataset) rồi mới trả ack — ack có thể mất vài giây, client nên đặt
 *   timeout lớn (vd socket.timeout(90_000).emit(...)). Dataset được cache nên các lần sau trả ngay.
 *   ack:     như trên + { overallResult, anomalyPointCount, analysisId? (recording), withAnomaly:true }
 *   server:  mỗi mẫu một message  'ecg-point-anomaly'  { …như ecg-point, isAnomaly: 0 | 1 }
 *
 * ── Chung ────────────────────────────────────────────────────────────────────────────────────────────────────────
 *   'list-ecg-datasets' {}   -> { status:'ok', datasets:[{ name, available, sampleRateHz }] }  (dropdown ECG_A…F)
 *   'stream-ecg-stop'   {}   -> dừng stream hiện tại (kể cả đang chờ AI).
 *   'ecg-stream-end'    { streamId, source, sourceName, totalPoints }  server phát khi hết tín hiệu.
 *   Mỗi socket chỉ có 1 stream; bắt đầu stream mới dừng/huỷ stream cũ. Ngắt kết nối cũng dừng.
 *   Lỗi khi bắt đầu trả qua ack: { status:'error', code, message } | { status:'forbidden' }.
 *
 * Xác thực/phân quyền/CORS dùng cùng quy ước với '/lab-alerts' (LAB_ALERT_CORS_ORIGINS, LAB_ALERT_REQUIRE_AUTH).
 * Giới hạn kích thước tệp upload: ECG_STREAM_MAX_UPLOAD_BYTES (mặc định 10MB) — áp qua EcgStreamIoAdapter trong main.ts.
 */
const CORS_ORIGIN: string[] | string | boolean = process.env.LAB_ALERT_CORS_ORIGINS
    ? process.env.LAB_ALERT_CORS_ORIGINS.split(',').map((o) => o.trim())
    : process.env.NODE_ENV === 'production'
      ? false
      : '*';

const STREAM_ROLES: ActorRole[] = [ACTOR_ROLE.DOCTOR, ACTOR_ROLE.LAB_STAFF, ACTOR_ROLE.NURSE, ACTOR_ROLE.ADMIN];
const requireAuth = (): boolean => process.env.LAB_ALERT_REQUIRE_AUTH !== 'false';
const isValidId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 64;
const bad = (message: string, code = 'INVALID_REQUEST') => ({ status: 'error' as const, code, message });

interface StreamBody {
    // nguồn — đúng một
    file?: unknown;
    dataset?: unknown;
    recordingId?: unknown;
    // kèm file
    fileName?: unknown;
    sampleRateHz?: unknown;
    leadNames?: unknown;
    // chung
    lead?: unknown;
    speed?: unknown;
    startMs?: unknown;
    analysisId?: unknown;
}

type ParsedSource = { source: EcgStreamSource } | { error: ReturnType<typeof bad> };

/** Socket.IO server trả Buffer cho dữ liệu nhị phân; chấp nhận thêm ArrayBuffer/Uint8Array cho client/bridge khác. */
function toBuffer(v: unknown): Buffer | null {
    if (Buffer.isBuffer(v)) return v;
    if (v instanceof ArrayBuffer) return Buffer.from(v);
    if (ArrayBuffer.isView(v)) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
    return null;
}

@WebSocketGateway({ namespace: 'ecg-stream', cors: { origin: CORS_ORIGIN } })
export class EcgStreamGateway implements OnGatewayConnection, OnGatewayDisconnect {
    private readonly logger = new Logger(EcgStreamGateway.name);
    private readonly sessions = new Map<string, EcgPlayback>();
    /** Mỗi lần start/stop tăng token để huỷ lần start đang chờ nạp dữ liệu/AI (có thể mất hàng chục giây). */
    private readonly tokens = new Map<string, number>();
    private readonly preparing = new Set<string>();
    private streamSeq = 0;

    constructor(
        private readonly jwtService: JwtService,
        private readonly actorRoleService: ActorRoleService,
        private readonly streamService: EcgStreamService,
    ) {}

    async handleConnection(client: Socket) {
        if (!requireAuth()) {
            this.logger.log(`Client connected (auth off): ${client.id}`);
            return;
        }
        try {
            const token = this.extractToken(client);
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

    handleDisconnect(client: Socket) {
        this.cancel(client.id);
        this.tokens.delete(client.id);
        this.logger.log(`Client disconnected: ${client.id}`);
    }

    /** API [1] — từng điểm giá trị theo thời gian. */
    @SubscribeMessage('stream-ecg')
    handleStream(@ConnectedSocket() client: Socket, @MessageBody() body: StreamBody) {
        return this.start(client, body, false);
    }

    /** API [2] — như [1] kèm isAnomaly 0/1 cho từng điểm. */
    @SubscribeMessage('stream-ecg-anomaly')
    handleStreamAnomaly(@ConnectedSocket() client: Socket, @MessageBody() body: StreamBody) {
        return this.start(client, body, true);
    }

    /** Danh sách dataset ECG_A..F cho dropdown. */
    @SubscribeMessage('list-ecg-datasets')
    async handleListDatasets(@ConnectedSocket() client: Socket) {
        if (!(await this.authorize(client))) return { status: 'forbidden' };
        return { status: 'ok', datasets: await this.streamService.listDatasets() };
    }

    @SubscribeMessage('stream-ecg-stop')
    handleStop(@ConnectedSocket() client: Socket) {
        return { status: this.cancel(client.id) ? 'stopped' : 'idle' };
    }

    private async start(client: Socket, body: StreamBody | undefined, withAnomaly: boolean) {
        const parsed = this.parseSource(body);
        if ('error' in parsed) return parsed.error;

        const speed = body?.speed === undefined ? 1 : Number(body.speed);
        if (!Number.isFinite(speed) || speed < ECG_STREAM_MIN_SPEED || speed > ECG_STREAM_MAX_SPEED) {
            return bad(`speed phải trong khoảng ${ECG_STREAM_MIN_SPEED}–${ECG_STREAM_MAX_SPEED}`);
        }
        const startMs = body?.startMs === undefined ? 0 : Number(body.startMs);
        if (!Number.isFinite(startMs) || startMs < 0) return bad('startMs phải là số >= 0');
        const lead = body?.lead;
        if (lead !== undefined && typeof lead !== 'string' && typeof lead !== 'number') return bad('lead phải là tên (vd "II") hoặc chỉ số');

        if (!(await this.authorize(client))) {
            this.logger.warn(`Từ chối stream ECG của ${client.id}: chưa xác thực hoặc sai vai trò`);
            return { status: 'forbidden' };
        }

        // Một socket - một stream: huỷ stream cũ (đang phát hoặc đang chờ AI) trước khi nạp dữ liệu mới.
        this.cancel(client.id);
        const token = (this.tokens.get(client.id) ?? 0) + 1;
        this.tokens.set(client.id, token);
        this.preparing.add(client.id);

        let prepared;
        try {
            prepared = await this.streamService.prepare({ source: parsed.source, lead, withAnomaly, startMs });
        } catch (err) {
            if (err instanceof EcgStreamError) return { status: 'error', code: err.code, message: err.message };
            this.logger.error(`Chuẩn bị stream ECG thất bại: ${(err as Error).message}`);
            return bad('Không thể bắt đầu stream.', 'INTERNAL_ERROR');
        } finally {
            if (this.tokens.get(client.id) === token) this.preparing.delete(client.id);
        }
        // Bị huỷ (stop / start mới / ngắt kết nối) trong lúc chờ nạp dữ liệu hoặc AI.
        if (this.tokens.get(client.id) !== token || client.disconnected) return bad('Yêu cầu stream đã bị huỷ.', 'CANCELLED');

        const streamId = `${client.id}:${++this.streamSeq}`;
        const event = withAnomaly ? 'ecg-point-anomaly' : 'ecg-point';
        const base = {
            streamId,
            source: prepared.source,
            sourceName: prepared.sourceName,
            ...(prepared.recordingId ? { recordingId: prepared.recordingId } : {}),
            lead: prepared.lead,
        };
        const session = new EcgPlayback({
            samples: prepared.samples,
            sampleRateHz: prepared.sampleRateHz,
            flags: prepared.flags,
            startIndex: prepared.startIndex,
            speed,
            onPoint: (p) => client.emit(event, { ...base, ...p }),
            onEnd: (total) => {
                this.sessions.delete(client.id);
                client.emit('ecg-stream-end', { streamId, source: prepared.source, sourceName: prepared.sourceName, ...(prepared.recordingId ? { recordingId: prepared.recordingId } : {}), totalPoints: total });
            },
        });
        this.sessions.set(client.id, session);

        const ack = {
            status: 'streaming',
            ...base,
            withAnomaly,
            sampleRateHz: prepared.sampleRateHz,
            totalPoints: prepared.totalPoints,
            durationMs: prepared.durationMs,
            speed,
            startMs,
            ...(withAnomaly ? { overallResult: prepared.overallResult, anomalyPointCount: prepared.anomalyPointCount, ...(prepared.analysisId ? { analysisId: prepared.analysisId } : {}) } : {}),
        };
        // Phát bắt đầu sau khi ack được trả (client cần streamId/metadata trước khi nhận điểm đầu tiên).
        setImmediate(() => {
            if (this.sessions.get(client.id) === session) session.start();
        });
        return ack;
    }

    /** Kiểm tra đúng một nguồn + hợp lệ hoá các trường đi kèm. */
    private parseSource(body: StreamBody | undefined): ParsedSource {
        const given = (['file', 'dataset', 'recordingId'] as const).filter((k) => body?.[k] !== undefined);
        if (given.length !== 1) return { error: bad('Chỉ định đúng MỘT nguồn: file (upload .npy/.csv), dataset (ECG_A…ECG_F) hoặc recordingId.') };

        if (given[0] === 'dataset') {
            const name = normalizeDatasetName(body?.dataset);
            if (!name) return { error: bad(`dataset phải thuộc ${ECG_DATASET_NAMES.join(', ')}`) };
            return { source: { kind: 'dataset', name } };
        }

        if (given[0] === 'recordingId') {
            if (!isValidId(body?.recordingId)) return { error: bad('recordingId không hợp lệ') };
            if (body?.analysisId !== undefined && !isValidId(body.analysisId)) return { error: bad('analysisId không hợp lệ') };
            return { source: { kind: 'recording', recordingId: body.recordingId, analysisId: body?.analysisId as string | undefined } };
        }

        // file upload
        const data = toBuffer(body?.file);
        if (!data) return { error: bad('file phải là dữ liệu nhị phân (Buffer/ArrayBuffer/Blob).') };
        if (data.length === 0) return { error: bad('file rỗng.') };
        const max = getStreamMaxUploadBytes();
        if (data.length > max) return { error: bad(`file vượt quá ${Math.round(max / 1024 / 1024)}MB.`, 'FILE_TOO_LARGE') };
        const fileName = body?.fileName;
        if (typeof fileName !== 'string' || fileName.length === 0 || fileName.length > 255) return { error: bad('Cần fileName (vd "ecg.npy") để nhận biết định dạng.') };
        if (!new RegExp(`\\.(${ECG_UPLOAD_STREAM_FORMATS.join('|')})$`, 'i').test(fileName)) {
            return { error: bad(`Chỉ nhận tệp ${ECG_UPLOAD_STREAM_FORMATS.map((f) => '.' + f).join(' hoặc ')}.`, 'UNSUPPORTED_FILE_TYPE') };
        }
        const sampleRateHz = Number(body?.sampleRateHz);
        if (body?.sampleRateHz === undefined || !Number.isInteger(sampleRateHz) || sampleRateHz < 50 || sampleRateHz > 4000) {
            return { error: bad('Upload cần sampleRateHz là số nguyên trong [50, 4000] (tệp .npy/.csv không chứa thông tin này).') };
        }
        let leadNames: string[] | undefined;
        if (body?.leadNames !== undefined) {
            const ln = body.leadNames;
            if (!Array.isArray(ln) || ln.length === 0 || ln.length > 12 || ln.some((n) => typeof n !== 'string' || n.length === 0 || n.length > 20)) {
                return { error: bad('leadNames phải là mảng 1–12 chuỗi (mỗi chuỗi ≤ 20 ký tự).') };
            }
            leadNames = ln as string[];
        }
        return { source: { kind: 'upload', data, fileName, sampleRateHz, leadNames } };
    }

    private async authorize(client: Socket): Promise<boolean> {
        if (!requireAuth()) return true;
        const userId: string | undefined = client.data.userId;
        if (!userId) return false;
        try {
            await this.actorRoleService.assertActorRole(userId, STREAM_ROLES);
            return true;
        } catch {
            return false;
        }
    }

    /** Dừng stream đang phát và huỷ start đang chờ. true nếu có gì để huỷ. */
    private cancel(clientId: string): boolean {
        const session = this.sessions.get(clientId);
        const wasPreparing = this.preparing.delete(clientId);
        if (session) {
            session.stop();
            this.sessions.delete(clientId);
        }
        if (session || wasPreparing) this.tokens.set(clientId, (this.tokens.get(clientId) ?? 0) + 1);
        return !!session || wasPreparing;
    }

    private extractToken(client: Socket): string | null {
        const authToken: unknown = client.handshake.auth?.token;
        if (typeof authToken === 'string' && authToken) return authToken.replace(/^Bearer\s+/i, '');
        const header = client.handshake.headers.authorization;
        return typeof header === 'string' && /^Bearer\s+/i.test(header) ? header.replace(/^Bearer\s+/i, '') : null;
    }
}
