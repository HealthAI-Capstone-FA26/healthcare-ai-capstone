import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { VitalSignDetectionOrchestrator } from './vital-sign-detection.orchestrator';
import { VitalSessionCreatedEvent, VITAL_SESSION_CREATED_EVENT } from './vital-session-created.event';
import { VitalAlertGateway } from './vital-alert.gateway';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Lắng nghe event 'vital-session.created', chạy detection (rule + ai) ở background,
 * rồi push kết quả realtime qua WebSocket cho client đang theo dõi encounter đó.
 * Mọi lỗi phải được catch + log tại đây — vì đây là fire-and-forget,
 * không có ai await kết quả trực tiếp từ API tạo session.
 */
@Injectable()
export class VitalSignDetectionListener {
    private readonly logger = new Logger(VitalSignDetectionListener.name);
    private readonly orchestrator: VitalSignDetectionOrchestrator;

    constructor(
        private readonly prisma: PrismaService,
        private readonly alertGateway: VitalAlertGateway,
    ) {
        this.orchestrator = new VitalSignDetectionOrchestrator(this.prisma);
    }

    @OnEvent(VITAL_SESSION_CREATED_EVENT, { async: true })
    async handleVitalSessionCreated(event: VitalSessionCreatedEvent): Promise<void> {
        try {
            const results = await this.orchestrator.run(event.vitalSessionId);
            const abnormalCount = results.filter((r) => r.isAbnormal).length;

            this.logger.log(
                `Detection xong cho session ${event.vitalSessionId}: ${abnormalCount}/${results.length} bất thường`,
            );

            // Cần encounterId để biết push vào room nào — lấy lại từ session
            const session = await this.prisma.vitalSignSession.findUnique({
                where: { vitalSessionId: event.vitalSessionId },
                select: { encounterId: true },
            });

            if (session) {
                this.alertGateway.pushAlertUpdate({
                    vitalSessionId: event.vitalSessionId,
                    encounterId: session.encounterId,
                    totalObservations: results.length,
                    abnormalCount,
                    results,
                });
            }
        } catch (err) {
            // Không throw lại — tránh làm crash process do unhandled rejection.
            // Cần có cơ chế giám sát log/alerting riêng để phát hiện session bị lỗi detection.
            this.logger.error(
                `Detection thất bại cho session ${event.vitalSessionId}: ${(err as Error).message}`,
                (err as Error).stack,
            );
        }
    }
}