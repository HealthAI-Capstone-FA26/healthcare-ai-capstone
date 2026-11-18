import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma, ResultParameter } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { LabTaskService } from '../lab-task-intake/lab-task.service';
import { DiagnosticProgressService } from '../lab-task-intake/diagnostic-progress.service';
import { SubmitLabResultDto } from './dtos/submit-lab-result.dto';
import { UpdateLabResultDto } from './dtos/update-lab-result.dto';
import { ReviewLabResultDto } from './dtos/review-lab-result.dto';
import { LabResultValueDto } from './dtos/lab-result-value.dto';
import { AddLabAttachmentDto } from './dtos/add-lab-attachment.dto';
import { LabResultSubmittedEvent, LAB_RESULT_SUBMITTED_EVENT } from '../lab-anomaly/events/lab-result-submitted.event';
import { ActorRoleService } from '../../identity-access/user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { CompleteLabResultDto } from './dtos/complete-lab-result.dto';
import {
    DIAGNOSTIC_URL_EXPIRY_SECONDS,
    assertFileSignature,
    isExternalUrl,
    presignDiagnosticFile,
    uploadDiagnosticFile,
} from './diagnostic-upload.config';

/** Tệp được tính là "hình ảnh" khi hoàn tất báo cáo hình ảnh. */
const IMAGE_FILE_TYPES = ['dicom', 'image', 'video'];

type ResolvedValue = {
    parameterId: string;
    valueNumeric: number | null;
    valueBoolean: boolean | null;
    valueText: string | null;
};

const SAFE_USER_SELECT = { userId: true, email: true, profile: { select: { fullName: true } } } as const;

const RESULT_INCLUDE = {
    values: { include: { parameter: true, alerts: true } },
    attachments: true,
    enteredByUser: { select: SAFE_USER_SELECT },
    reviewedByUser: { select: SAFE_USER_SELECT },
    task: { include: { orderItem: { include: { service: true } }, diagnosticRoom: true } },
} satisfies Prisma.DiagnosticResultInclude;

/**
 * SE04 — Nhập/tra cứu kết quả cận lâm sàng (DiagnosticResult + ResultValue) và tệp đính kèm.
 *
 * Kết quả chỉ được lưu cho DiagnosticTask 'in_progress' đã qua ràng buộc thanh toán. Yêu cầu dữ liệu theo
 * ServiceCatalog.resultKind: parametric (values) · image_report (findings/kết luận) · waveform (ECG: findings hoặc
 * đã có EcgRecording hoàn tất).
 *
 * Nộp kết quả = 1 transaction: lưu kết quả -> task 'completed' -> DiagnosticProgressService tính lại Order/Encounter.
 * Event chỉ phát SAU commit.
 *
 * NGOẠI LỆ — dịch vụ 'image_report' (siêu âm tim, X-quang ngực): nộp kết quả chỉ LƯU kết quả, task vẫn 'in_progress'
 * để KTV tải hình ảnh lên. Task chỉ 'completed' (và bác sĩ mới được báo "có kết quả") khi gọi completeResult(), nơi
 * kiểm tra đã có hình ảnh. Nhờ vậy bác sĩ không bao giờ nhận kết quả chỉ có chữ mà thiếu hình.
 */
@Injectable()
export class LabResultService {
    private readonly logger = new Logger(LabResultService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly labTaskService: LabTaskService,
        private readonly progress: DiagnosticProgressService,
        private readonly eventEmitter: EventEmitter2,
        private readonly actorRoleService: ActorRoleService,
    ) {}

    /** Validate + chuẩn hoá values theo ResultParameter.dataType; tham số phải thuộc đúng dịch vụ của task. */
    private async resolveAndValidateValues(values: LabResultValueDto[], serviceId: string): Promise<ResolvedValue[]> {
        const parameterIds = values.map((v) => v.parameterId);
        if (new Set(parameterIds).size !== parameterIds.length) {
            throw new BadRequestException('Danh sách chỉ số có tham số bị trùng.');
        }

        const parameters = await this.prisma.resultParameter.findMany({ where: { parameterId: { in: parameterIds } } });
        const paramById = new Map<string, ResultParameter>(parameters.map((p) => [p.parameterId, p]));

        const missing = parameterIds.filter((id) => !paramById.has(id));
        if (missing.length > 0) {
            throw new BadRequestException(`Không tìm thấy tham số kết quả: ${missing.join(', ')}`);
        }

        return values.map((v) => {
            const parameter = paramById.get(v.parameterId)!;
            if (parameter.serviceId !== serviceId) {
                throw new BadRequestException(`Tham số '${parameter.parameterCode}' không thuộc dịch vụ của nhiệm vụ này.`);
            }

            const resolved: ResolvedValue = { parameterId: v.parameterId, valueNumeric: null, valueBoolean: null, valueText: null };
            switch (parameter.dataType) {
                case 'numeric':
                    if (v.valueNumeric === undefined || v.valueNumeric === null) {
                        throw new BadRequestException(`Tham số '${parameter.parameterCode}' yêu cầu giá trị số (valueNumeric).`);
                    }
                    resolved.valueNumeric = v.valueNumeric;
                    break;
                case 'boolean':
                    if (typeof v.valueBoolean !== 'boolean') {
                        throw new BadRequestException(`Tham số '${parameter.parameterCode}' yêu cầu giá trị đúng/sai (valueBoolean).`);
                    }
                    resolved.valueBoolean = v.valueBoolean;
                    break;
                case 'enum': {
                    const allowed = this.extractAllowedValues(parameter.allowedValues);
                    if (!v.valueText || (allowed.length > 0 && !allowed.includes(v.valueText))) {
                        throw new BadRequestException(
                            `Tham số '${parameter.parameterCode}' chỉ nhận một trong: ${allowed.join(', ') || '(chưa cấu hình)'}.`,
                        );
                    }
                    resolved.valueText = v.valueText;
                    break;
                }
                default: // text
                    if (!v.valueText) {
                        throw new BadRequestException(`Tham số '${parameter.parameterCode}' yêu cầu giá trị dạng chữ (valueText).`);
                    }
                    resolved.valueText = v.valueText;
            }
            return resolved;
        });
    }

    /** allowedValues là JSON: mảng chuỗi, hoặc mảng object { value, label }. */
    private extractAllowedValues(raw: Prisma.JsonValue | null): string[] {
        if (!Array.isArray(raw)) return [];
        return raw
            .map((item) =>
                typeof item === 'string' ? item : item && typeof item === 'object' && 'value' in item ? String((item as { value: unknown }).value) : null,
            )
            .filter((x): x is string => x !== null);
    }

    private hasText(s?: string | null): boolean {
        return typeof s === 'string' && s.trim().length > 0;
    }

    /** Nộp kết quả lần đầu. Người nhập (JWT) phải là LAB_STAFF. */
    async submitResult(taskId: string, dto: SubmitLabResultDto, enteredByUserId: string) {
        await this.actorRoleService.assertActorRole(enteredByUserId, [ACTOR_ROLE.LAB_STAFF]);

        await this.labTaskService.assertReadyForResultEntry(taskId);

        const task = await this.prisma.diagnosticTask.findUniqueOrThrow({
            where: { taskId },
            include: { orderItem: { include: { service: true } }, result: { select: { resultId: true } } },
        });
        if (task.result) {
            throw new BadRequestException('Nhiệm vụ này đã có kết quả. Dùng PATCH /lab-results/:id để sửa/bổ sung.');
        }

        const service = task.orderItem.service;
        const hasValues = !!dto.values && dto.values.length > 0;
        const hasNarrative = this.hasText(dto.findings) || this.hasText(dto.overallConclusion);

        if (service.resultKind === 'parametric' && !hasValues) {
            throw new BadRequestException('Dịch vụ dạng chỉ số cần nhập ít nhất một chỉ số kết quả (values).');
        }
        if (service.resultKind === 'image_report' && !hasNarrative) {
            throw new BadRequestException('Dịch vụ dạng báo cáo hình ảnh cần có mô tả (findings) hoặc kết luận (overallConclusion).');
        }
        if (service.resultKind === 'waveform' && !hasNarrative) {
            const recordings = await this.prisma.ecgRecording.count({ where: { taskId, status: 'completed' } });
            if (recordings === 0) {
                throw new BadRequestException(
                    'Kết quả ECG cần có mô tả (findings/kết luận) hoặc ít nhất một bản ghi ECG đã hoàn tất của nhiệm vụ.',
                );
            }
        }

        const resolvedValues = hasValues ? await this.resolveAndValidateValues(dto.values!, service.serviceId) : [];
        const now = new Date();

        const deferCompletion = service.resultKind === 'image_report';

        const { resultId, becameAwaitingReview } = await this.prisma.$transaction(async (tx) => {
            const created = await tx.diagnosticResult.create({
                data: {
                    taskId,
                    enteredByUserId,
                    findings: dto.findings,
                    overallConclusion: dto.overallConclusion,
                    resultStatus: dto.resultStatus ?? 'preliminary',
                    performedAt: dto.performedAt ? new Date(dto.performedAt) : (task.startedAt ?? now),
                    resultedAt: dto.resultedAt ? new Date(dto.resultedAt) : now,
                    values: { create: resolvedValues },
                },
            });

            if (deferCompletion) {
                return { resultId: created.resultId, becameAwaitingReview: false };
            }

            await this.labTaskService.markCompleted(taskId, tx);
            const snapshot = await this.progress.recomputeForTask(taskId, tx);

            return { resultId: created.resultId, becameAwaitingReview: snapshot?.encounterBecameAwaitingReview ?? false };
        });

        if (!deferCompletion) {
            this.eventEmitter.emit(LAB_RESULT_SUBMITTED_EVENT, new LabResultSubmittedEvent(resultId, becameAwaitingReview));
        }

        this.logger.log(
            `Đã lưu kết quả ${resultId} cho nhiệm vụ ${taskId} (${service.resultKind}, ${resolvedValues.length} chỉ số)` +
                (deferCompletion ? ' — chờ tải hình ảnh rồi hoàn tất (POST /lab-results/:id/complete)' : ''),
        );
        return this.getById(resultId);
    }

    async getByLabTaskId(taskId: string) {
        const result = await this.prisma.diagnosticResult.findUnique({ where: { taskId }, include: RESULT_INCLUDE });
        if (!result) {
            throw new NotFoundException(`Nhiệm vụ ${taskId} chưa có kết quả`);
        }
        return result;
    }

    async getById(resultId: string) {
        const result = await this.prisma.diagnosticResult.findUnique({ where: { resultId }, include: RESULT_INCLUDE });
        if (!result) {
            throw new NotFoundException(`Không tìm thấy kết quả ${resultId}`);
        }
        return result;
    }

    /**
     * Sửa/bổ sung kết quả. Người sửa phải là LAB_STAFF hoặc DOCTOR. Kết quả đang 'final' mà sửa values/findings/
     * overallConclusion thì tự chuyển 'corrected' (lưu vết đính chính). Sau khi sửa, detection chạy lại ở nền.
     */
    async updateResult(resultId: string, dto: UpdateLabResultDto, actingUserId: string) {
        await this.actorRoleService.assertActorRole(actingUserId, [ACTOR_ROLE.LAB_STAFF, ACTOR_ROLE.DOCTOR]);

        const existing = await this.prisma.diagnosticResult.findUnique({
            where: { resultId },
            include: { task: { include: { orderItem: { select: { serviceId: true } } } } },
        });
        if (!existing) {
            throw new NotFoundException(`Không tìm thấy kết quả ${resultId}`);
        }

        const hasValueChanges = !!dto.values && dto.values.length > 0;
        const resolvedValues = hasValueChanges
            ? await this.resolveAndValidateValues(dto.values!, existing.task.orderItem.serviceId)
            : [];

        const hasContentChanges = hasValueChanges || dto.findings !== undefined || dto.overallConclusion !== undefined;
        const nextStatus = dto.resultStatus ?? (hasContentChanges && existing.resultStatus === 'final' ? 'corrected' : existing.resultStatus);

        await this.prisma.$transaction(async (tx) => {
            await tx.diagnosticResult.update({
                where: { resultId },
                data: {
                    ...(dto.findings !== undefined ? { findings: dto.findings } : {}),
                    ...(dto.overallConclusion !== undefined ? { overallConclusion: dto.overallConclusion } : {}),
                    resultStatus: nextStatus,
                },
            });

            for (const value of resolvedValues) {
                const { parameterId, ...data } = value;
                await tx.resultValue.upsert({
                    where: { resultId_parameterId: { resultId, parameterId } },
                    create: { resultId, parameterId, ...data },
                    update: data,
                });
            }
        });

        // Báo cáo hình ảnh chưa hoàn tất: detection/thông báo chạy ở completeResult(), không chạy sớm ở đây.
        if (existing.task.status === 'completed') {
            this.eventEmitter.emit(LAB_RESULT_SUBMITTED_EVENT, new LabResultSubmittedEvent(resultId, false));
        }

        this.logger.log(`Đã cập nhật kết quả ${resultId} (resultStatus: ${nextStatus})`);
        return this.getById(resultId);
    }

    /**
     * Bác sĩ đọc/duyệt kết quả (vd: ECG, siêu âm): ghi reviewedByUserId/reviewedAt, tuỳ chọn cập nhật kết luận và chốt
     * 'final'. Chỉ DOCTOR. Không chạy lại detection (không đổi chỉ số).
     */
    async reviewResult(resultId: string, dto: ReviewLabResultDto, reviewerUserId: string) {
        await this.actorRoleService.assertActorRole(reviewerUserId, [ACTOR_ROLE.DOCTOR]);

        const existing = await this.prisma.diagnosticResult.findUnique({ where: { resultId } });
        if (!existing) {
            throw new NotFoundException(`Không tìm thấy kết quả ${resultId}`);
        }
        if (existing.resultStatus === 'cancelled') {
            throw new BadRequestException('Kết quả đã bị huỷ, không thể duyệt.');
        }

        await this.prisma.diagnosticResult.update({
            where: { resultId },
            data: {
                reviewedByUserId: reviewerUserId,
                reviewedAt: new Date(),
                ...(dto.overallConclusion !== undefined ? { overallConclusion: dto.overallConclusion } : {}),
                ...(dto.finalize && existing.resultStatus !== 'final' ? { resultStatus: 'final' } : {}),
            },
        });

        this.logger.log(`Bác sĩ ${reviewerUserId} đã duyệt kết quả ${resultId}${dto.finalize ? ' và chốt final' : ''}`);
        return this.getById(resultId);
    }

    /**
     * Đính kèm tệp cho kết quả (ảnh X-quang, DICOM, cine-loop, PDF, bản in ECG...). Người tải lên phải là LAB_STAFF.
     * Có `file` (multipart) -> upload MinIO/S3, lưu objectName; không có `file` thì bắt buộc `dto.fileUrl`.
     */
    async addAttachment(resultId: string, dto: AddLabAttachmentDto, uploadedByUserId: string, file?: Express.Multer.File) {
        await this.actorRoleService.assertActorRole(uploadedByUserId, [ACTOR_ROLE.LAB_STAFF]);

        const result = await this.prisma.diagnosticResult.findUnique({ where: { resultId } });
        if (!result) {
            throw new NotFoundException(`Không tìm thấy kết quả ${resultId}`);
        }

        let metadata: Prisma.InputJsonValue | undefined;
        if (dto.metadata) {
            try {
                metadata = JSON.parse(dto.metadata) as Prisma.InputJsonValue;
            } catch {
                throw new BadRequestException('metadata phải là chuỗi JSON hợp lệ.');
            }
        }

        let fileUrl: string;
        if (file) {
            assertFileSignature(file, dto.fileType);
            fileUrl = (await uploadDiagnosticFile(file, `diagnostic-attachments/${resultId}`)).objectName;
        } else if (dto.fileUrl) {
            fileUrl = dto.fileUrl;
        } else {
            throw new BadRequestException('Phải cung cấp tệp đính kèm (file) hoặc fileUrl có sẵn.');
        }

        const attachment = await this.prisma.diagnosticResultAttachment.create({
            data: {
                resultId,
                fileType: dto.fileType,
                attachmentRole: dto.attachmentRole ?? 'primary',
                fileUrl,
                mimeType: file?.mimetype ?? dto.mimeType,
                sizeBytes: file ? BigInt(file.size) : undefined,
                description: dto.description,
                metadata,
                capturedAt: dto.capturedAt ? new Date(dto.capturedAt) : undefined,
                uploadedByUserId,
                uploadedAt: new Date(),
            },
        });

        this.logger.log(`Đã đính kèm tệp ${attachment.attachmentId} vào kết quả ${resultId}`);
        return attachment;
    }

    /**
     * Hoàn tất kết quả dạng báo cáo hình ảnh (siêu âm tim, X-quang ngực): kiểm tra đã có hình -> task 'completed' ->
     * tính lại Order/Encounter -> phát event (detection + thông báo bác sĩ). Người gọi phải là LAB_STAFF.
     */
    async completeResult(resultId: string, dto: CompleteLabResultDto, userId: string) {
        await this.actorRoleService.assertActorRole(userId, [ACTOR_ROLE.LAB_STAFF]);

        const result = await this.prisma.diagnosticResult.findUnique({
            where: { resultId },
            include: {
                attachments: { select: { fileType: true } },
                task: { include: { orderItem: { include: { service: { select: { resultKind: true, serviceName: true } } } } } },
            },
        });
        if (!result) {
            throw new NotFoundException(`Không tìm thấy kết quả ${resultId}`);
        }
        if (result.task.orderItem.service.resultKind !== 'image_report') {
            throw new BadRequestException(
                'Chỉ áp dụng cho dịch vụ dạng báo cáo hình ảnh (siêu âm, X-quang). Dịch vụ khác tự hoàn tất khi nộp kết quả.',
            );
        }
        if (result.task.status === 'completed') {
            throw new ConflictException('Kết quả này đã được hoàn tất trước đó.');
        }
        if (result.task.status !== 'in_progress') {
            throw new BadRequestException(`Nhiệm vụ đang ở trạng thái '${result.task.status}', không thể hoàn tất.`);
        }
        if (result.resultStatus === 'cancelled') {
            throw new BadRequestException('Kết quả đã bị huỷ, không thể hoàn tất.');
        }

        const hasImage = result.attachments.some((a) => IMAGE_FILE_TYPES.includes(a.fileType));
        const reason = dto.noImageReason?.trim();
        if (!hasImage && !reason) {
            throw new BadRequestException(
                `Chưa có hình ảnh (dicom/image/video) cho '${result.task.orderItem.service.serviceName}'. ` +
                    'Hãy tải hình lên (POST /lab-results/:id/attachments) hoặc nêu lý do trong noImageReason.',
            );
        }

        const taskId = result.taskId;
        const becameAwaitingReview = await this.prisma.$transaction(async (tx) => {
            if (!hasImage && reason) {
                const note = `[Không có hình ảnh đính kèm: ${reason}]`;
                await tx.diagnosticResult.update({
                    where: { resultId },
                    data: { findings: result.findings ? `${result.findings}\n${note}` : note },
                });
            }
            await this.labTaskService.markCompleted(taskId, tx);
            const snapshot = await this.progress.recomputeForTask(taskId, tx);
            return snapshot?.encounterBecameAwaitingReview ?? false;
        });

        this.eventEmitter.emit(LAB_RESULT_SUBMITTED_EVENT, new LabResultSubmittedEvent(resultId, becameAwaitingReview));
        this.logger.log(`Đã hoàn tất kết quả hình ảnh ${resultId} (nhiệm vụ ${taskId}${hasImage ? '' : ', KHÔNG có hình: ' + reason})`);
        return this.getById(resultId);
    }

    /** Danh sách tệp đính kèm kèm presigned URL ngắn hạn. Chỉ LAB_STAFF / DOCTOR. */
    async listAttachments(resultId: string, actingUserId: string) {
        await this.actorRoleService.assertActorRole(actingUserId, [ACTOR_ROLE.LAB_STAFF, ACTOR_ROLE.DOCTOR]);

        const rows = await this.prisma.diagnosticResultAttachment.findMany({
            where: { resultId },
            orderBy: { uploadedAt: 'asc' },
        });
        this.logger.log(`User ${actingUserId} truy cập ${rows.length} tệp của kết quả ${resultId}`);
        return Promise.all(rows.map((row) => this.withAccessUrl(row)));
    }

    /** Presigned URL cho 1 tệp. Chỉ LAB_STAFF / DOCTOR. */
    async getAttachmentAccessUrl(attachmentId: string, actingUserId: string) {
        await this.actorRoleService.assertActorRole(actingUserId, [ACTOR_ROLE.LAB_STAFF, ACTOR_ROLE.DOCTOR]);

        const row = await this.prisma.diagnosticResultAttachment.findUnique({ where: { attachmentId } });
        if (!row) {
            throw new NotFoundException(`Không tìm thấy tệp đính kèm ${attachmentId}`);
        }
        this.logger.log(`User ${actingUserId} truy cập tệp ${attachmentId} (kết quả ${row.resultId})`);
        return this.withAccessUrl(row);
    }

    private async withAccessUrl<T extends { fileUrl: string }>(row: T) {
        const external = isExternalUrl(row.fileUrl);
        return {
            ...row,
            accessUrl: external ? row.fileUrl : await presignDiagnosticFile(row.fileUrl),
            accessUrlExpiresInSeconds: external ? null : DIAGNOSTIC_URL_EXPIRY_SECONDS,
        };
    }
}
