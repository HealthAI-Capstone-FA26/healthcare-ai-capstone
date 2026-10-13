import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { basename } from 'path';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ActorRoleService } from '../../user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { ECG_SIGNAL_STORAGE, EcgSignalStorage } from '../ecg-recording/ecg-signal-storage.port';
import { LabAlertGateway } from '../lab-anomaly/lab-alert.gateway';
import { NotificationDispatcherService } from '../notification/notification-dispatcher.service';
import { ECG_ANOMALY_PROVIDER, ECG_SEVERITIES, EcgAiError, EcgAnalyzeResult, EcgAnomalyProvider } from './ecg-anomaly-provider.port';
import { ReanalyzeEcgDto } from './dto/reanalyze-ecg.dto';
import { ECG_ANALYSIS_QUEUED_EVENT, EcgAnalysisQueuedEvent } from './events/ecg-analysis-queued.event';

const AI_TASK_TYPE = 'ecg_anomaly_detection';
/** Bảo vệ DB nếu model trả quá nhiều đoạn bất thường: giữ tối đa N đoạn điểm cao nhất. */
const MAX_EVENTS_PER_ANALYSIS = 500;
/** Gửi thông báo ecg_anomaly_alert cho bác sĩ khi có bất thường từ mức này trở lên. */
const NOTIFY_MIN_SEVERITY = 'high';
const MAX_ERROR_MESSAGE = 500;

const severityRank = (s: string) => ECG_SEVERITIES.indexOf(s as (typeof ECG_SEVERITIES)[number]);

const ANALYSIS_INCLUDE = {
    modelVersion: { select: { modelName: true, version: true, status: true } },
    events: { orderBy: { startOffsetMs: 'asc' } },
} satisfies Prisma.EcgAiAnalysisInclude;

/**
 * SE04 — Phân tích AI bất thường ECG (chạy lô trên bản ghi đã tải lên).
 *
 * Vòng đời EcgAiAnalysis: queued -> running -> completed | failed | skipped.
 * NFR độ tin cậy: mọi lỗi AI (chưa cấu hình, timeout, mất kết nối, phản hồi sai) chỉ làm analysis 'failed'/'skipped'
 * kèm errorCode — KHÔNG bao giờ ném ra ngoài, quy trình thủ công (nhập kết quả ECG) không bị chặn.
 *
 * isCurrent: chỉ MỘT analysis hiển thị cho mỗi recording. Analysis 'completed' mới nhất giành isCurrent; nếu chưa có
 * analysis nào completed thì bản failed/skipped gần nhất giữ isCurrent để UI hiển thị trạng thái lỗi.
 */
@Injectable()
export class EcgAnalysisService {
    private readonly logger = new Logger(EcgAnalysisService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
        private readonly eventEmitter: EventEmitter2,
        private readonly alertGateway: LabAlertGateway,
        private readonly dispatcher: NotificationDispatcherService,
        @Inject(ECG_SIGNAL_STORAGE) private readonly storage: EcgSignalStorage,
        @Inject(ECG_ANOMALY_PROVIDER) private readonly provider: EcgAnomalyProvider,
    ) {}

    // ------------------------------------------------------------------------------------------------------------
    // Xếp hàng
    // ------------------------------------------------------------------------------------------------------------

    /**
     * Tạo 1 analysis 'queued' và phát event để chạy nền. Trả null nếu chưa có model 'active' (không có gì để chạy —
     * không phải lỗi). Ném ConflictException nếu recording đang có analysis queued/running.
     */
    async enqueue(ecgRecordingId: string, mode: 'batch' | 'reanalysis', options: ReanalyzeEcgDto = {}) {
        const recording = await this.prisma.ecgRecording.findUnique({ where: { ecgRecordingId } });
        if (!recording) throw new NotFoundException(`Không tìm thấy bản ghi ECG ${ecgRecordingId}`);
        if (recording.status !== 'completed') {
            throw new BadRequestException(`Chỉ phân tích được bản ghi 'completed' (hiện '${recording.status}').`);
        }

        const model = options.modelVersionId
            ? await this.prisma.aiModelVersion.findFirst({
                  where: { modelVersionId: options.modelVersionId, taskType: AI_TASK_TYPE, status: { in: ['active', 'candidate'] } },
              })
            : await this.prisma.aiModelVersion.findFirst({
                  where: { taskType: AI_TASK_TYPE, status: 'active' },
                  orderBy: [{ deployedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
              });

        if (!model) {
            if (options.modelVersionId) {
                throw new BadRequestException("modelVersionId không tồn tại hoặc không ở trạng thái 'active'/'candidate' cho ecg_anomaly_detection.");
            }
            this.logger.warn(`Không có AiModelVersion 'active' cho ${AI_TASK_TYPE} — bỏ qua phân tích bản ghi ${ecgRecordingId}.`);
            return null;
        }

        const inflight = await this.prisma.ecgAiAnalysis.findFirst({
            where: { ecgRecordingId, status: { in: ['queued', 'running'] } },
            select: { analysisId: true },
        });
        if (inflight) {
            throw new ConflictException(`Bản ghi đang có phân tích chưa xong (${inflight.analysisId}).`);
        }

        const spec = (model.inputSpec ?? {}) as { windowMs?: number; strideMs?: number };
        const analysis = await this.prisma.ecgAiAnalysis.create({
            data: {
                ecgRecordingId,
                modelVersionId: model.modelVersionId,
                analysisMode: mode,
                status: 'queued',
                isCurrent: false, // chỉ giành isCurrent khi hoàn tất (xem persistSuccess / markFailed)
                thresholdUsed: options.threshold ?? (model.defaultThreshold !== null ? Number(model.defaultThreshold) : null),
                windowMs: typeof spec.windowMs === 'number' ? spec.windowMs : null,
                strideMs: typeof spec.strideMs === 'number' ? spec.strideMs : null,
            },
        });

        this.eventEmitter.emit(ECG_ANALYSIS_QUEUED_EVENT, new EcgAnalysisQueuedEvent(analysis.analysisId));
        return analysis;
    }

    /** API: chạy lại phân tích (LAB_STAFF hoặc DOCTOR). Trả analysis 'queued' ngay (202), kết quả đến qua realtime/GET. */
    async reanalyze(ecgRecordingId: string, dto: ReanalyzeEcgDto, userId: string) {
        await this.actorRoleService.assertActorRole(userId, [ACTOR_ROLE.LAB_STAFF, ACTOR_ROLE.DOCTOR]);

        const analysis = await this.enqueue(ecgRecordingId, 'reanalysis', dto);
        if (!analysis) {
            throw new BadRequestException("Chưa có model AI 'active' cho phân tích bất thường ECG.");
        }
        return analysis;
    }

    // ------------------------------------------------------------------------------------------------------------
    // Chạy (nền)
    // ------------------------------------------------------------------------------------------------------------

    /** Chạy 1 analysis đã 'queued'. KHÔNG BAO GIỜ ném lỗi: mọi sự cố ghi vào analysis. */
    async run(analysisId: string): Promise<void> {
        const claim = await this.prisma.ecgAiAnalysis.updateMany({
            where: { analysisId, status: 'queued' },
            data: { status: 'running', startedAt: new Date() },
        });
        if (claim.count === 0) return; // đã có worker khác nhận / không còn queued

        const analysis = await this.prisma.ecgAiAnalysis.findUniqueOrThrow({
            where: { analysisId },
            include: { ecgRecording: true, modelVersion: true },
        });
        const recording = analysis.ecgRecording;

        try {
            if (!this.provider.isConfigured()) {
                throw new EcgAiError('AI_NOT_CONFIGURED', 'Chưa cấu hình dịch vụ AI.', true);
            }
            if (!recording.signalFileUrl || !recording.signalFormat) {
                throw new EcgAiError('SIGNAL_MISSING', 'Bản ghi chưa có tệp tín hiệu.');
            }

            let signal: Buffer;
            try {
                signal = await this.storage.get(recording.signalFileUrl);
            } catch (err) {
                throw new EcgAiError('SIGNAL_READ_FAILED', `Không đọc được tệp tín hiệu: ${(err as Error).message}`);
            }

            const startedMs = Date.now();
            const result = await this.provider.analyze({
                recordingId: recording.ecgRecordingId,
                signal,
                fileName: basename(recording.signalFileUrl),
                signalFormat: recording.signalFormat,
                sampleRateHz: recording.sampleRateHz,
                numLeads: recording.numLeads,
                leadNames: recording.leadNames,
                durationMs: recording.durationMs,
                model: { name: analysis.modelVersion.modelName, version: analysis.modelVersion.version },
                options: {
                    ...(analysis.thresholdUsed !== null ? { threshold: Number(analysis.thresholdUsed) } : {}),
                    ...(analysis.windowMs !== null ? { windowMs: analysis.windowMs } : {}),
                    ...(analysis.strideMs !== null ? { strideMs: analysis.strideMs } : {}),
                },
            });

            await this.persistSuccess(analysisId, recording.ecgRecordingId, result, Date.now() - startedMs);
            await this.afterCompleted(analysisId, recording.ecgRecordingId, result);
        } catch (err) {
            await this.markFailed(analysisId, recording.ecgRecordingId, err);
        }
    }

    private async persistSuccess(analysisId: string, ecgRecordingId: string, result: EcgAnalyzeResult, elapsedMs: number) {
        // Giữ tối đa MAX_EVENTS đoạn có điểm cao nhất, lưu theo thứ tự thời gian.
        const anomalies = [...result.anomalies].sort((a, b) => b.score - a.score).slice(0, MAX_EVENTS_PER_ANALYSIS).sort((a, b) => a.startOffsetMs - b.startOffsetMs);
        if (anomalies.length < result.anomalies.length) {
            this.logger.warn(`Analysis ${analysisId}: AI trả ${result.anomalies.length} đoạn, chỉ lưu ${anomalies.length} đoạn điểm cao nhất.`);
        }
        const now = new Date();

        await this.prisma.$transaction(async (tx) => {
            await tx.ecgAiAnalysis.update({
                where: { analysisId },
                data: {
                    status: 'completed',
                    overallResult: result.overallResult,
                    anomalyCount: result.anomalies.length,
                    maxAnomalyScore: result.maxAnomalyScore ?? (result.anomalies.length ? Math.max(...result.anomalies.map((a) => a.score)) : null),
                    thresholdUsed: result.thresholdUsed ?? undefined,
                    windowMs: result.windowMs ?? undefined,
                    strideMs: result.strideMs ?? undefined,
                    summaryMetrics: (result.summaryMetrics ?? undefined) as Prisma.InputJsonValue | undefined,
                    inferenceLatencyMs: result.inferenceLatencyMs ?? elapsedMs,
                    errorCode: null,
                    errorMessage: null,
                    completedAt: now,
                },
            });

            if (anomalies.length > 0) {
                await tx.ecgAnomalyEvent.createMany({
                    data: anomalies.map((a) => ({
                        analysisId,
                        anomalyType: a.anomalyType,
                        anomalyScore: a.score,
                        severity: a.severity,
                        startOffsetMs: a.startOffsetMs,
                        endOffsetMs: a.endOffsetMs,
                        affectedLeads: a.affectedLeads,
                        heartRateBpm: a.heartRateBpm,
                        details: (a.details ?? undefined) as Prisma.InputJsonValue | undefined,
                        detectedAt: now,
                    })),
                });
            }

            if (result.signalQuality !== null) {
                await tx.ecgRecording.update({ where: { ecgRecordingId }, data: { signalQuality: result.signalQuality } });
            }

            // Analysis completed mới nhất giành isCurrent.
            await tx.ecgAiAnalysis.updateMany({ where: { ecgRecordingId, analysisId: { not: analysisId } }, data: { isCurrent: false } });
            await tx.ecgAiAnalysis.update({ where: { analysisId }, data: { isCurrent: true } });
        });
    }

    private async markFailed(analysisId: string, ecgRecordingId: string, err: unknown) {
        const aiErr = err instanceof EcgAiError ? err : null;
        const code = aiErr?.code ?? 'AI_INTERNAL_ERROR';
        const message = (aiErr?.message ?? (err as Error)?.message ?? String(err)).slice(0, MAX_ERROR_MESSAGE);
        const status = aiErr?.skip ? 'skipped' : 'failed';

        if (status === 'failed') {
            this.logger.error(`Phân tích ECG ${analysisId} thất bại [${code}]: ${message}`);
        } else {
            this.logger.warn(`Phân tích ECG ${analysisId} bị bỏ qua [${code}]: ${message}`);
        }

        try {
            await this.prisma.$transaction(async (tx) => {
                await tx.ecgAiAnalysis.update({
                    where: { analysisId },
                    data: { status, errorCode: code, errorMessage: message, completedAt: new Date() },
                });
                // Chưa có analysis completed nào -> bản lỗi này hiển thị để UI báo "AI không khả dụng".
                const completed = await tx.ecgAiAnalysis.count({ where: { ecgRecordingId, status: 'completed' } });
                if (completed === 0) {
                    await tx.ecgAiAnalysis.updateMany({ where: { ecgRecordingId, analysisId: { not: analysisId } }, data: { isCurrent: false } });
                    await tx.ecgAiAnalysis.update({ where: { analysisId }, data: { isCurrent: true } });
                }
            });
            await this.pushSafely(analysisId, ecgRecordingId, status, null, 0, null, code);
        } catch (persistErr) {
            this.logger.error(`Không ghi được trạng thái lỗi cho analysis ${analysisId}: ${(persistErr as Error).message}`);
        }
    }

    // ------------------------------------------------------------------------------------------------------------
    // Sau khi hoàn tất: realtime + thông báo (lỗi ở đây không làm hỏng analysis đã lưu)
    // ------------------------------------------------------------------------------------------------------------

    private async afterCompleted(analysisId: string, ecgRecordingId: string, result: EcgAnalyzeResult) {
        const top = result.anomalies.reduce<EcgAnalyzeResult['anomalies'][number] | null>(
            (best, a) => (best === null || severityRank(a.severity) > severityRank(best.severity) || (a.severity === best.severity && a.score > best.score) ? a : best),
            null,
        );

        const ctx = await this.pushSafely(analysisId, ecgRecordingId, 'completed', result.overallResult, result.anomalies.length, top?.severity ?? null, null);

        if (top && ctx?.doctorUserId && severityRank(top.severity) >= severityRank(NOTIFY_MIN_SEVERITY)) {
            try {
                await this.dispatcher.dispatch(
                    {
                        recipient: { userId: ctx.doctorUserId },
                        notificationType: 'ecg_anomaly_alert',
                        referenceType: 'ecg_ai_analysis',
                        referenceId: analysisId,
                        title: 'Cảnh báo AI: bất thường trên điện tâm đồ',
                        content:
                            `AI phát hiện ${result.anomalies.length} đoạn bất thường trên ECG (mức cao nhất: ${top.severity}` +
                            `${top.anomalyType ? `, ${top.anomalyType}` : ''}) — lượt khám ${ctx.encounterId}. Cần bác sĩ xem xét.`,
                    },
                    ['in_app'],
                );
            } catch (err) {
                this.logger.error(`Gửi thông báo ecg_anomaly_alert thất bại (analysis ${analysisId}): ${(err as Error).message}`);
            }
        }
    }

    private async pushSafely(
        analysisId: string,
        ecgRecordingId: string,
        status: string,
        overallResult: string | null,
        anomalyCount: number,
        maxSeverity: string | null,
        errorCode: string | null,
    ): Promise<{ encounterId: string; doctorUserId: string | null } | null> {
        try {
            const ctx = await this.resolveContext(ecgRecordingId);
            this.alertGateway.pushEcgAlertUpdate({
                ecgRecordingId,
                analysisId,
                encounterId: ctx.encounterId,
                status,
                overallResult,
                anomalyCount,
                maxSeverity,
                errorCode,
            });
            return ctx;
        } catch (err) {
            this.logger.error(`Đẩy cảnh báo ECG realtime thất bại (analysis ${analysisId}): ${(err as Error).message}`);
            return null;
        }
    }

    /** encounterId + bác sĩ chỉ định (nhận thông báo) của 1 bản ghi ECG. */
    private async resolveContext(ecgRecordingId: string) {
        const rec = await this.prisma.ecgRecording.findUniqueOrThrow({
            where: { ecgRecordingId },
            select: {
                encounterId: true,
                task: { select: { orderItem: { select: { order: { select: { doctor: { select: { userId: true } } } } } } } },
            },
        });
        return { encounterId: rec.encounterId, doctorUserId: rec.task.orderItem.order.doctor?.userId ?? null };
    }

    // ------------------------------------------------------------------------------------------------------------
    // Truy vấn
    // ------------------------------------------------------------------------------------------------------------

    async listByRecording(ecgRecordingId: string) {
        const exists = await this.prisma.ecgRecording.findUnique({ where: { ecgRecordingId }, select: { ecgRecordingId: true } });
        if (!exists) throw new NotFoundException(`Không tìm thấy bản ghi ECG ${ecgRecordingId}`);
        return this.prisma.ecgAiAnalysis.findMany({ where: { ecgRecordingId }, orderBy: { createdAt: 'desc' }, include: ANALYSIS_INCLUDE });
    }

    async getById(analysisId: string) {
        const analysis = await this.prisma.ecgAiAnalysis.findUnique({ where: { analysisId }, include: ANALYSIS_INCLUDE });
        if (!analysis) throw new NotFoundException(`Không tìm thấy phân tích ${analysisId}`);
        return analysis;
    }
}
