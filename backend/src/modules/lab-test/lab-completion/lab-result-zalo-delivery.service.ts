import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../../prisma/prisma.service';
import { BUCKET_NAME, minioClient } from '../../../common/configs/upload.config';
import { RedisService } from '../../../redis/redis.service';
import { NotificationContactResolver } from '../../platform/notification/notification-contact.resolver';
import { ZaloOaSender } from '../../platform/notification/zalo-oa.sender';
import { ECG_SIGNAL_STORAGE, EcgSignalStorage } from '../ecg-recording/ecg-signal-storage.port';
import { isStreamableFormat, parseEcgSignal } from '../ecg-stream/ecg-signal-reader';
import { isExternalUrl, presignDiagnosticFile } from '../lab-result-entry/diagnostic-upload.config';
import { buildBloodTestPdf, buildEcgPdf, ResultPdfPatient } from './lab-result-pdf.builder';

/** Mỗi dịch vụ hình ảnh (X-quang / siêu âm) gửi tối đa bấy nhiêu ảnh để không spam chat. */
const MAX_IMAGES_PER_TASK = 3;
/** Zalo tải ảnh ngay khi nhận lệnh gửi nên URL chỉ cần sống ngắn. */
const PHOTO_URL_TTL_SECONDS = 15 * 60;

/** Báo cáo kết quả lần gửi — endpoint test trả nguyên văn; luồng thật bỏ qua. */
export interface LabZaloDeliveryReport {
    /** chat_id Zalo đã dùng (null nếu chưa xác định được). */
    chatId: string | null;
    /** Tài liệu đã gửi đi, vd: 'blood_test: Xét nghiệm máu (PDF link)'. */
    sent: string[];
    /** Bỏ qua kèm lý do (không phải lỗi). */
    skipped: string[];
    /** Lỗi từng tài liệu (đã nuốt lỗi, không ảnh hưởng tài liệu khác). */
    errors: string[];
}

/**
 * Gửi tài liệu kết quả cận lâm sàng cho bệnh nhân qua Zalo Bot sau khi hoàn tất lab test (encounter -> 'awaiting_review'):
 *  - Xét nghiệm máu : PDF (gửi LINK tải, vì Zalo Bot không gửi được file)
 *  - ECG            : đọc tín hiệu đã lưu (json/csv/npy) -> vẽ biểu đồ -> PDF (gửi LINK tải)
 *  - X-quang/Siêu âm: ảnh đính kèm -> sendPhoto
 *
 * BEST-EFFORT: không bao giờ throw — lỗi gửi tài liệu không được làm hỏng luồng nghiệp vụ / thông báo chính.
 * Chỉ gửi khi bệnh nhân đã liên kết Zalo Bot (PatientZaloLink) và không tắt kênh zalo_oa trong NotificationPreference.
 */
@Injectable()
export class LabResultZaloDeliveryService {
    private readonly logger = new Logger(LabResultZaloDeliveryService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly zalo: ZaloOaSender,
        private readonly contactResolver: NotificationContactResolver,
        private readonly redis: RedisService,
        @Inject(ECG_SIGNAL_STORAGE) private readonly ecgStorage: EcgSignalStorage,
    ) {}

    /**
     * @param opts.zaloUserId chỉ dùng khi test: gửi thẳng tới chat_id này, bỏ qua liên kết bệnh nhân / preference.
     */
    async sendResultsForEncounter(encounterId: string, opts: { zaloUserId?: string } = {}): Promise<LabZaloDeliveryReport> {
        const report: LabZaloDeliveryReport = { chatId: null, sent: [], skipped: [], errors: [] };
        try {
            await this.run(encounterId, opts.zaloUserId?.trim() || undefined, report);
        } catch (err) {
            report.errors.push((err as Error).message);
            this.logger.error(`Gửi tài liệu kết quả qua Zalo thất bại (encounter ${encounterId}): ${(err as Error).message}`, (err as Error).stack);
        }
        return report;
    }

    private async run(encounterId: string, overrideChatId: string | undefined, report: LabZaloDeliveryReport): Promise<void> {
        if (!this.zalo.isConfigured()) {
            report.skipped.push('Chưa cấu hình Zalo (ZALO_BOT_TOKEN hoặc ZALO_OA_*)');
            return;
        }

        const encounter = await this.prisma.encounter.findUnique({
            where: { encounterId },
            select: { encounterCode: true, patient: { select: { patientId: true, fullName: true, patientCode: true } } },
        });
        if (!encounter) {
            report.skipped.push(`Không tìm thấy encounter ${encounterId}`);
            return;
        }

        // Lấy chat_id Zalo (tôn trọng NotificationPreference); chưa liên kết bot thì thôi. Test có thể truyền thẳng chat_id.
        let chatId = overrideChatId;
        if (!chatId) {
            const contact = await this.contactResolver.resolve({ patientId: encounter.patient.patientId }, 'zalo_oa', 'diagnostics_completed');
            if (!contact.allowed || !contact.destination) {
                const reason = contact.reason ?? 'NO_CONTACT';
                this.logger.debug(`Encounter ${encounterId}: không gửi tài liệu Zalo (${reason}).`);
                report.skipped.push(`Bệnh nhân chưa liên kết Zalo Bot hoặc đã tắt kênh (${reason}) — nhắn SĐT cho bot hoặc truyền zaloUserId`);
                return;
            }
            chatId = contact.destination;
        }
        report.chatId = chatId;
        const patient: ResultPdfPatient = {
            fullName: encounter.patient.fullName,
            patientCode: encounter.patient.patientCode,
            encounterCode: encounter.encounterCode,
        };

        // Chỉ lấy task đã hoàn tất và chỉ định chưa bị huỷ (cùng điều kiện với thông báo hoàn tất)
        const tasks = await this.prisma.diagnosticTask.findMany({
            where: { status: 'completed', orderItem: { status: 'ordered', order: { encounterId } } },
            orderBy: { completedAt: 'asc' },
            select: {
                orderItem: { select: { service: { select: { serviceName: true, modality: true } } } },
                result: {
                    select: {
                        resultedAt: true,
                        overallConclusion: true,
                        values: {
                            select: {
                                valueNumeric: true,
                                valueBoolean: true,
                                valueText: true,
                                isAbnormal: true,
                                parameter: { select: { parameterName: true, unit: true, displayOrder: true } },
                            },
                        },
                        attachments: { select: { fileType: true, attachmentRole: true, fileUrl: true, uploadedAt: true } },
                    },
                },
                ecgRecordings: {
                    where: { status: 'completed' },
                    orderBy: { createdAt: 'desc' },
                    take: 1,
                    select: {
                        sampleRateHz: true,
                        numLeads: true,
                        leadNames: true,
                        signalFormat: true,
                        signalFileUrl: true,
                        startedAt: true,
                        createdAt: true,
                        analyses: {
                            where: { isCurrent: true, status: 'completed' },
                            take: 1,
                            select: {
                                overallResult: true,
                                events: { orderBy: { startOffsetMs: 'asc' }, select: { anomalyType: true, severity: true, startOffsetMs: true, endOffsetMs: true } },
                            },
                        },
                    },
                },
            },
        });

        if (tasks.length === 0) report.skipped.push('Encounter chưa có chỉ định nào ở trạng thái completed');

        for (const task of tasks) {
            const { serviceName, modality } = task.orderItem.service;
            const result = task.result;
            if (!result) {
                report.skipped.push(`${modality}: ${serviceName} chưa có kết quả`);
                continue;
            }

            // Mỗi tài liệu try/catch riêng — 1 tài liệu lỗi không chặn các tài liệu còn lại
            await this.safely(`${modality}/${serviceName}`, report, async () => {
                if (modality === 'blood_test') {
                    const rows = [...result.values]
                        .sort((a, b) => a.parameter.displayOrder - b.parameter.displayOrder)
                        .map((v) => ({
                            name: v.parameter.parameterName,
                            value:
                                v.valueNumeric != null
                                    ? String(Number(v.valueNumeric.toString())) // bỏ số 0 thừa của Decimal(12,4)
                                    : v.valueBoolean != null
                                      ? v.valueBoolean
                                          ? 'Dương tính'
                                          : 'Âm tính'
                                      : (v.valueText ?? '-'),
                            unit: v.parameter.unit ?? '',
                            abnormal: v.isAbnormal,
                        }));
                    if (rows.length === 0) {
                        report.skipped.push(`blood_test: ${serviceName} chưa có chỉ số nào`);
                        return;
                    }
                    const pdf = await buildBloodTestPdf({ patient, serviceName, resultedAt: result.resultedAt, rows, conclusion: result.overallConclusion });
                    await this.deliverPdf(chatId, pdf, `blood-test-${patient.encounterCode ?? encounterId}.pdf`, `Kết quả xét nghiệm máu (${serviceName})`);
                    report.sent.push(`blood_test: ${serviceName} (PDF, ${rows.length} chỉ số)`);
                } else if (modality === 'ecg') {
                    report.sent.push(...(await this.sendEcg(chatId, patient, task.ecgRecordings[0], encounterId, report)).map((m) => `ecg: ${m}`));
                } else if (modality === 'xray' || modality === 'echo') {
                    const n = await this.sendImages(chatId, serviceName, patient, result.attachments);
                    if (n > 0) report.sent.push(`${modality}: ${serviceName} (${n} ảnh)`);
                    else report.skipped.push(`${modality}: ${serviceName} không có ảnh fileType 'image' (DICOM/video không gửi được)`);
                }
            });
        }
    }

    /** ECG: đọc tín hiệu đã lưu (tương đương dữ liệu từ GET ecg-recordings/:id/signal-url) rồi vẽ thành PDF. */
    private async sendEcg(
        chatId: string,
        patient: ResultPdfPatient,
        rec:
            | {
                  sampleRateHz: number;
                  numLeads: number;
                  leadNames: string[];
                  signalFormat: string | null;
                  signalFileUrl: string | null;
                  startedAt: Date | null;
                  createdAt: Date;
                  analyses: { overallResult: string | null; events: { anomalyType: string | null; severity: string; startOffsetMs: number; endOffsetMs: number }[] }[];
              }
            | undefined,
        encounterId: string,
        report: LabZaloDeliveryReport,
    ): Promise<string[]> {
        if (!rec?.signalFileUrl) {
            report.skipped.push('ecg: chưa có bản ghi ECG hoàn tất hoặc chưa có tệp tín hiệu');
            return [];
        }

        // wfdb/edf/dicom/scp backend chưa đọc được -> báo ngắn gọn thay vì im lặng
        if (!isStreamableFormat(rec.signalFormat)) {
            await this.zalo.sendText(chatId, `Điện tâm đồ (ECG) đã hoàn tất nhưng định dạng ${rec.signalFormat ?? 'khác'} chưa xuất được biểu đồ. Vui lòng xem kết quả tại bệnh viện.`);
            report.skipped.push(`ecg: định dạng '${rec.signalFormat}' chưa vẽ được (đã gửi tin nhắn thông báo)`);
            return [];
        }

        const raw = await this.ecgStorage.get(rec.signalFileUrl);
        const parsed = parseEcgSignal(rec.signalFormat, raw, { leadNames: rec.leadNames, numLeads: rec.numLeads });
        const analysis = rec.analyses[0];

        const pdf = await buildEcgPdf({
            patient,
            sampleRateHz: rec.sampleRateHz,
            leadNames: parsed.leadNames,
            leads: parsed.leads,
            recordedAt: rec.startedAt ?? rec.createdAt,
            aiOverallResult: analysis?.overallResult ?? null,
            anomalies: analysis?.events ?? [],
        });
        await this.deliverPdf(chatId, pdf, `ecg-${patient.encounterCode ?? encounterId}.pdf`, 'Biểu đồ điện tâm đồ (ECG)');
        return [`Biểu đồ điện tâm đồ (PDF, ${parsed.leads.length} lead)`];
    }

    /** X-quang / siêu âm: chỉ gửi ảnh (fileType 'image'); DICOM/video không hiển thị được trên Zalo nên bỏ qua. */
    private async sendImages(
        chatId: string,
        serviceName: string,
        patient: ResultPdfPatient,
        attachments: { fileType: string; attachmentRole: string; fileUrl: string; uploadedAt: Date }[],
    ): Promise<number> {
        const rank = (role: string) => (role === 'key_image' ? 0 : role === 'primary' ? 1 : 2); // ảnh chính trước
        const images = attachments
            .filter((a) => a.fileType === 'image')
            .sort((a, b) => rank(a.attachmentRole) - rank(b.attachmentRole) || a.uploadedAt.getTime() - b.uploadedAt.getTime())
            .slice(0, MAX_IMAGES_PER_TASK);

        for (const img of images) {
            const url = isExternalUrl(img.fileUrl) ? img.fileUrl : await presignDiagnosticFile(img.fileUrl, PHOTO_URL_TTL_SECONDS);
            await this.zalo.sendPhoto(chatId, url, `${serviceName} - ${patient.fullName}`);
        }
        return images.length;
    }

    /**
     * Zalo Bot không gửi được file -> upload PDF lên S3 rồi gửi LINK có hạn (cùng cơ chế token /zalo-bot/pdf/:token
     * của phiếu khám). Chế độ OA: gửi file trực tiếp. Hạn link chỉnh bằng ZALO_PDF_LINK_TTL_SECONDS (mặc định 1 giờ).
     */
    private async deliverPdf(chatId: string, buffer: Buffer, filename: string, label: string): Promise<void> {
        if (!this.zalo.isBotMode()) {
            await this.zalo.sendFile(chatId, buffer, filename);
            return;
        }
        // Tên object ngẫu nhiên (UUID) để không đoán được đường dẫn dữ liệu y tế
        const objectName = `lab-result-pdfs/${randomUUID()}.pdf`;
        await minioClient.putObject(BUCKET_NAME, objectName, buffer, buffer.length, { 'Content-Type': 'application/pdf' });
        const ttl = Number(process.env.ZALO_PDF_LINK_TTL_SECONDS ?? 3600);
        const token = randomUUID();
        await this.redis.setJson(`zalo:pdf:${token}`, { objectName }, ttl);
        const base = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
        await this.zalo.sendText(chatId, `${label}:\n${base}/api/v1/zalo-bot/pdf/${token}\nLink có hiệu lực khoảng ${Math.round(ttl / 60)} phút.`);
    }

    private async safely(label: string, report: LabZaloDeliveryReport, fn: () => Promise<void>): Promise<void> {
        try {
            await fn();
        } catch (err) {
            report.errors.push(`${label}: ${(err as Error).message}`);
            this.logger.warn(`Gửi tài liệu '${label}' qua Zalo lỗi: ${(err as Error).message}`);
        }
    }
}
