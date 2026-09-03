import { Controller, Post, Param, Inject } from '@nestjs/common';
import { VitalSignDetectionOrchestrator } from './vital-sign-detection.orchestrator';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Ví dụ controller NestJS. Nếu bạn dùng framework khác (Express thuần, Fastify...),
 * chỉ cần gọi VitalSignDetectionOrchestrator.run(vitalSessionId) trong handler tương ứng.
 *
 * Orchestrator hiện chạy 2 detector: RuleBasedDetector (đã hoạt động) và
 * AiVitalSignDetector (stub, trả về rỗng cho tới khi bạn cài logic AI thật
 * trong ai-vital-sign.detector.ts — không cần đổi gì ở controller này).
 *
 * Cách gắn PrismaClient: đổi 'PrismaClient' bên dưới thành PrismaService của bạn
 * nếu project đã có sẵn provider quản lý kết nối Prisma.
 */
@Controller('vital-sessions')
export class VitalSignAlertController {
    private readonly orchestrator: VitalSignDetectionOrchestrator;

    constructor(private readonly prisma: PrismaService) {
        this.orchestrator = new VitalSignDetectionOrchestrator(this.prisma);
    }

    /**
     * POST /vital-sessions/:id/detect-alerts
     * Chạy toàn bộ detector (rule + ai) cho session, trả về kết quả đã gộp
     * theo từng observation (bất thường hay không, mức độ, nguồn phát hiện).
     */
    @Post(':id/detect-alerts')
    async detectAlerts(@Param('id') vitalSessionId: string) {
        const results = await this.orchestrator.run(vitalSessionId);
        return {
            vitalSessionId,
            totalObservations: results.length,
            abnormalCount: results.filter((r) => r.isAbnormal).length,
            results,
        };
    }
}
