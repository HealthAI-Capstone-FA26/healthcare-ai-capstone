import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { extname } from 'path';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ActorRoleService } from '../../user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { CreateEcgRecordingDto } from './dto/create-ecg-recording.dto';
import { ECG_FORMAT_EXTENSIONS } from './ecg-upload.config';
import { ECG_SIGNAL_STORAGE, EcgSignalStorage } from './ecg-signal-storage.port';
import { ECG_RECORDING_COMPLETED_EVENT, EcgRecordingCompletedEvent } from './events/ecg-recording-completed.event';

const SIGNAL_URL_EXPIRY_SECONDS = 10 * 60;

const RECORDING_DETAIL_INCLUDE = {
    analyses: {
        orderBy: { createdAt: 'desc' },
        include: { modelVersion: { select: { modelName: true, version: true, status: true } }, events: { orderBy: { startOffsetMs: 'asc' } } },
    },
} satisfies Prisma.EcgRecordingInclude;

/**
 * SE04 — Bản ghi ECG (EcgRecording): tải tệp tín hiệu lên MinIO + lưu metadata. Tín hiệu thô KHÔNG vào DB.
 *
 * Chỉ áp dụng cho DiagnosticTask có service.modality = 'ecg', đang 'in_progress' (đã thanh toán + đã tiếp nhận) và do
 * đúng kỹ thuật viên phụ trách thực hiện. Upload xong -> bản ghi 'completed' + event để AI phân tích ở nền.
 */
@Injectable()
export class EcgRecordingService {
    private readonly logger = new Logger(EcgRecordingService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly actorRoleService: ActorRoleService,
        private readonly eventEmitter: EventEmitter2,
        @Inject(ECG_SIGNAL_STORAGE) private readonly storage: EcgSignalStorage,
    ) {}

    async createFromFile(taskId: string, dto: CreateEcgRecordingDto, file: Express.Multer.File | undefined, userId: string) {
        await this.actorRoleService.assertActorRole(userId, [ACTOR_ROLE.LAB_STAFF]);

        if (!file || !file.buffer?.length) {
            throw new BadRequestException('Thiếu tệp tín hiệu ECG (field `file`) hoặc tệp rỗng.');
        }

        const ext = extname(file.originalname).toLowerCase();
        const allowed = ECG_FORMAT_EXTENSIONS[dto.signalFormat] ?? [];
        if (!allowed.includes(ext)) {
            throw new BadRequestException(`signalFormat '${dto.signalFormat}' yêu cầu tệp có phần mở rộng: ${allowed.join(' | ')} (nhận '${ext || 'không có'}').`);
        }
        if (dto.leadNames && dto.leadNames.length > 0 && dto.leadNames.length !== dto.numLeads) {
            throw new BadRequestException(`leadNames có ${dto.leadNames.length} phần tử nhưng numLeads = ${dto.numLeads}.`);
        }
        if (dto.startedAt && dto.endedAt && new Date(dto.endedAt) < new Date(dto.startedAt)) {
            throw new BadRequestException('endedAt không được trước startedAt.');
        }

        let acquisitionMeta: Prisma.InputJsonValue | undefined;
        if (dto.acquisitionMeta) {
            try {
                acquisitionMeta = JSON.parse(dto.acquisitionMeta) as Prisma.InputJsonValue;
            } catch {
                throw new BadRequestException('acquisitionMeta phải là chuỗi JSON hợp lệ.');
            }
        }

        const task = await this.prisma.diagnosticTask.findUnique({
            where: { taskId },
            include: { orderItem: { select: { service: { select: { modality: true } }, order: { select: { encounterId: true } } } } },
        });
        if (!task) throw new NotFoundException(`Không tìm thấy nhiệm vụ cận lâm sàng ${taskId}`);
        if (task.orderItem.service.modality !== 'ecg') {
            throw new BadRequestException(`Nhiệm vụ thuộc loại '${task.orderItem.service.modality}', chỉ nhiệm vụ ECG mới nhận bản ghi ECG.`);
        }
        if (!task.paymentVerified) {
            throw new ForbiddenException('Không thể ghi nhận: bệnh nhân chưa hoàn tất thanh toán cho chỉ định này.');
        }
        if (task.status !== 'in_progress') {
            throw new BadRequestException(`Nhiệm vụ đang ở trạng thái '${task.status}'. Cần tiếp nhận (in_progress) trước khi tải bản ghi ECG.`);
        }
        if (task.assignedStaffUserId && task.assignedStaffUserId !== userId) {
            throw new ForbiddenException('Nhiệm vụ này do kỹ thuật viên khác phụ trách.');
        }

        const checksum = createHash('sha256').update(file.buffer).digest('hex');
        const duplicate = await this.prisma.ecgRecording.findFirst({
            where: { taskId, signalChecksum: checksum, status: { not: 'cancelled' } },
            select: { ecgRecordingId: true },
        });
        if (duplicate) {
            throw new ConflictException(`Tệp này đã được tải lên cho nhiệm vụ (bản ghi ${duplicate.ecgRecordingId}).`);
        }

        const encounterId = task.orderItem.order.encounterId;
        const recordingId = (await this.prisma.ecgRecording.create({
            data: this.baseData(taskId, encounterId, dto, acquisitionMeta, checksum, file),
            select: { ecgRecordingId: true },
        })).ecgRecordingId;

        // Lưu object sau khi có id (key ổn định). Lỗi lưu -> xoá bản ghi nháp để không để lại 'ghost'.
        const objectName = `ecg/${encounterId}/${recordingId}${ext}`;
        try {
            await this.storage.put(objectName, file.buffer, file.mimetype);
        } catch (err) {
            await this.prisma.ecgRecording.delete({ where: { ecgRecordingId: recordingId } }).catch(() => undefined);
            this.logger.error(`Lưu tín hiệu ECG lên storage thất bại (recording ${recordingId}): ${(err as Error).message}`);
            throw new BadRequestException('Không lưu được tệp tín hiệu lên kho lưu trữ, vui lòng thử lại.');
        }

        await this.prisma.ecgRecording.update({
            where: { ecgRecordingId: recordingId },
            data: { signalFileUrl: objectName, status: 'completed' },
        });

        this.eventEmitter.emit(ECG_RECORDING_COMPLETED_EVENT, new EcgRecordingCompletedEvent(recordingId, dto.autoAnalyze ?? true));
        this.logger.log(`Đã lưu bản ghi ECG ${recordingId} (task ${taskId}, ${file.size} bytes, ${dto.signalFormat})`);

        return this.getById(recordingId);
    }

    private baseData(
        taskId: string,
        encounterId: string,
        dto: CreateEcgRecordingDto,
        acquisitionMeta: Prisma.InputJsonValue | undefined,
        checksum: string,
        file: Express.Multer.File,
    ): Prisma.EcgRecordingUncheckedCreateInput {
        return {
            taskId,
            encounterId,
            recordingMode: 'file_upload',
            recordingType: dto.recordingType,
            status: 'pending', // chuyển 'completed' sau khi lưu object thành công
            sampleRateHz: dto.sampleRateHz,
            numLeads: dto.numLeads,
            leadNames: dto.leadNames ?? [],
            durationMs: dto.durationMs,
            startedAt: dto.startedAt ? new Date(dto.startedAt) : undefined,
            endedAt: dto.endedAt ? new Date(dto.endedAt) : undefined,
            signalFormat: dto.signalFormat,
            signalSizeBytes: BigInt(file.size),
            signalChecksum: checksum,
            deviceModel: dto.deviceModel,
            deviceSerial: dto.deviceSerial,
            acquisitionMeta,
        };
    }

    async listByTask(taskId: string) {
        return this.prisma.ecgRecording.findMany({
            where: { taskId },
            orderBy: { createdAt: 'desc' },
            include: { analyses: { where: { isCurrent: true }, select: { analysisId: true, status: true, overallResult: true, anomalyCount: true, maxAnomalyScore: true } } },
        });
    }

    async getById(ecgRecordingId: string) {
        const recording = await this.prisma.ecgRecording.findUnique({ where: { ecgRecordingId }, include: RECORDING_DETAIL_INCLUDE });
        if (!recording) throw new NotFoundException(`Không tìm thấy bản ghi ECG ${ecgRecordingId}`);
        return recording;
    }

    /** URL tạm (10 phút) để FE tải/hiển thị tín hiệu gốc. Bản ghi phải có tệp. */
    async getSignalUrl(ecgRecordingId: string) {
        const recording = await this.prisma.ecgRecording.findUnique({ where: { ecgRecordingId }, select: { signalFileUrl: true, status: true } });
        if (!recording) throw new NotFoundException(`Không tìm thấy bản ghi ECG ${ecgRecordingId}`);
        if (!recording.signalFileUrl) throw new BadRequestException('Bản ghi chưa có tệp tín hiệu.');

        const url = await this.storage.presignedGetUrl(recording.signalFileUrl, SIGNAL_URL_EXPIRY_SECONDS);
        return { url, expiresInSeconds: SIGNAL_URL_EXPIRY_SECONDS };
    }

    /**
     * Huỷ bản ghi tải nhầm. Chỉ khi task chưa 'completed'. Các analysis của bản ghi bị bỏ khỏi 'isCurrent'.
     * Tệp trên storage được giữ lại (dấu vết kiểm toán); chỉ đổi trạng thái.
     */
    async cancel(ecgRecordingId: string, userId: string) {
        await this.actorRoleService.assertActorRole(userId, [ACTOR_ROLE.LAB_STAFF]);

        const recording = await this.prisma.ecgRecording.findUnique({ where: { ecgRecordingId }, include: { task: { select: { status: true, assignedStaffUserId: true } } } });
        if (!recording) throw new NotFoundException(`Không tìm thấy bản ghi ECG ${ecgRecordingId}`);
        if (recording.task.status !== 'in_progress') {
            throw new BadRequestException(`Chỉ huỷ được khi nhiệm vụ đang 'in_progress' (hiện '${recording.task.status}').`);
        }
        if (recording.task.assignedStaffUserId && recording.task.assignedStaffUserId !== userId) {
            throw new ForbiddenException('Nhiệm vụ này do kỹ thuật viên khác phụ trách.');
        }

        const changed = await this.prisma.$transaction(async (tx) => {
            const r = await tx.ecgRecording.updateMany({ where: { ecgRecordingId, status: { not: 'cancelled' } }, data: { status: 'cancelled' } });
            if (r.count > 0) await tx.ecgAiAnalysis.updateMany({ where: { ecgRecordingId }, data: { isCurrent: false } });
            return r.count;
        });
        if (changed === 0) throw new BadRequestException('Bản ghi đã được huỷ trước đó.');

        this.logger.log(`Đã huỷ bản ghi ECG ${ecgRecordingId} bởi ${userId}`);
        return this.getById(ecgRecordingId);
    }
}
