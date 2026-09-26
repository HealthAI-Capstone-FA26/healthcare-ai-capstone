import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LabResultParameter } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { LabTaskService } from '../lab-task-intake/lab-task.service';
import { SubmitLabResultDto } from './dtos/submit-lab-result.dto';
import { UpdateLabResultDto } from './dtos/update-lab-result.dto';
import { LabResultValueDto } from './dtos/lab-result-value.dto';
import { AddLabAttachmentDto } from './dtos/add-lab-attachment.dto';
import {
    LabResultSubmittedEvent,
    LAB_RESULT_SUBMITTED_EVENT,
} from '../lab-anomaly/events/lab-result-submitted.event';
import { ActorRoleService } from '../../user/actor-role.service';
import { ACTOR_ROLE } from '../../../common/constants/actor-role.constant';
import { uploadImageToS3 } from '../../../common/configs/upload.config';

/**
 * Nhập/tra cứu kết quả xét nghiệm (LabResult + LabResultValue) và tệp đính kèm.
 * Đây là nơi thực thi bước 2 của ràng buộc nghiệp vụ: kết quả chỉ được lưu cho 1 LabTask
 * đang 'in_progress' (đã qua kiểm tra thanh toán ở bước tiếp nhận — LabTaskService.receive),
 * và LabTaskService.assertReadyForResultEntry được gọi lại ở đây như một lớp phòng thủ nữa.
 */
@Injectable()
export class LabResultService {
    private readonly logger = new Logger(LabResultService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly labTaskService: LabTaskService,
        private readonly eventEmitter: EventEmitter2,
        private readonly actorRoleService: ActorRoleService,
    ) { }

    /** Validate + build dữ liệu Prisma cho danh sách value, đối chiếu đúng dataType của từng parameter. */
    private async resolveAndValidateValues(values: LabResultValueDto[]) {
        const parameterIds = values.map((v) => v.parameterId);
        const parameters = await this.prisma.labResultParameter.findMany({
            where: { parameterId: { in: parameterIds } },
        });
        const paramById = new Map<string, LabResultParameter>(parameters.map((p) => [p.parameterId, p]));

        const missing = parameterIds.filter((id) => !paramById.has(id));
        if (missing.length > 0) {
            throw new BadRequestException(`Không tìm thấy tham số xét nghiệm: ${missing.join(', ')}`);
        }

        return values.map((v) => {
            const parameter = paramById.get(v.parameterId)!;
            const dataType = parameter.dataType ?? 'numeric';

            if (dataType === 'numeric') {
                if (v.valueNumeric === undefined || v.valueNumeric === null) {
                    throw new BadRequestException(
                        `Tham số '${parameter.parameterCode}' yêu cầu giá trị số (valueNumeric).`,
                    );
                }
            } else if (!v.valueText) {
                throw new BadRequestException(
                    `Tham số '${parameter.parameterCode}' yêu cầu giá trị dạng chữ (valueText).`,
                );
            }

            return {
                parameterId: v.parameterId,
                valueNumeric: dataType === 'numeric' ? v.valueNumeric : null,
                valueText: dataType === 'numeric' ? null : v.valueText,
            };
        });
    }

    /**
     * Kỹ thuật viên nhập kết quả cho 1 LabTask. Sau khi lưu thành công:
     *  - LabTask chuyển sang 'completed';
     *  - emit 'lab-result.submitted' để chạy detection/AI/thông báo hoàn tất ở background.
     *
     * `enteredByUserId` (lấy từ JWT, xem LabResultController.submit) phải có actorRole LAB_STAFF.
     */
    async submitResult(labTaskId: string, dto: SubmitLabResultDto, enteredByUserId: string) {
        await this.actorRoleService.assertActorRole(enteredByUserId, [ACTOR_ROLE.LAB_STAFF]);
        await this.labTaskService.assertReadyForResultEntry(labTaskId);

        const existing = await this.prisma.labResult.findUnique({ where: { labTaskId } });
        if (existing) {
            throw new BadRequestException(
                'Nhiệm vụ này đã có kết quả — dùng API cập nhật (PATCH /lab-results/:id) để sửa/bổ sung.',
            );
        }

        const values = await this.resolveAndValidateValues(dto.values);
        const resultedAt = dto.resultedAt ? new Date(dto.resultedAt) : new Date();

        const labResult = await this.prisma.$transaction(async (tx) => {
            const created = await tx.labResult.create({
                data: {
                    labTaskId,
                    enteredByUserId,
                    // reviewedAt là field bắt buộc trong schema hiện tại; tạm mặc định = resultedAt
                    // cho tới khi có 1 bước "bác sĩ duyệt kết quả" riêng biệt trong luồng nghiệp vụ.
                    reviewedAt: resultedAt,
                    resultedAt,
                    overallConclusion: dto.overallConclusion,
                    resultStatus: dto.resultStatus ?? 'preliminary',
                    values: { create: values },
                },
                include: {
                    values: {
                        include: {
                            parameter: {
                                include: { labParameterThresholds: true },
                            },
                        },
                    },
                },
            });

            await this.labTaskService.markCompleted(labTaskId);

            return created;
        });

        this.eventEmitter.emit(LAB_RESULT_SUBMITTED_EVENT, new LabResultSubmittedEvent(labResult.labResultId));

        this.logger.log(`Đã lưu kết quả xét nghiệm cho nhiệm vụ ${labTaskId} (labResult ${labResult.labResultId})`);
        return labResult;
    }

    /**
     * Sửa/bổ sung kết quả đã lưu. Nếu resultStatus hiện tại đã là 'final' và có gửi `values`,
     * tự chuyển resultStatus sang 'corrected' để lưu vết đính chính trên EMR thay vì âm thầm
     * ghi đè kết quả đã chốt.
     *
     * `reviewedByUserId` (lấy từ JWT, xem LabResultController.update) phải có actorRole LAB_STAFF
     * hoặc DOCTOR — cả kỹ thuật viên tự sửa và bác sĩ xác nhận/đính chính kết quả đều hợp lệ.
     * LƯU Ý: model LabResult hiện KHÔNG có cột reviewedByUserId, nên actor ở đây chỉ dùng để
     * authorization (assertActorRole), chưa được ghi vào bản ghi. Nếu cần audit trail "ai đã sửa/
     * xác nhận kết quả", cần thêm migration cho cột này trước.
     */
    async updateResult(labResultId: string, dto: UpdateLabResultDto, reviewedByUserId: string) {
        await this.actorRoleService.assertActorRole(reviewedByUserId, [ACTOR_ROLE.LAB_STAFF, ACTOR_ROLE.DOCTOR]);

        const existing = await this.prisma.labResult.findUnique({
            where: { labResultId },
            include: { values: true },
        });
        if (!existing) {
            throw new NotFoundException(`Không tìm thấy kết quả xét nghiệm ${labResultId}`);
        }

        const hasValueChanges = !!dto.values && dto.values.length > 0;
        let resolvedValues: Awaited<ReturnType<typeof this.resolveAndValidateValues>> = [];
        if (hasValueChanges) {
            resolvedValues = await this.resolveAndValidateValues(dto.values!);
        }

        const nextResultStatus =
            dto.resultStatus ?? (hasValueChanges && existing.resultStatus === 'final' ? 'corrected' : existing.resultStatus);

        await this.prisma.$transaction(async (tx) => {
            await tx.labResult.update({
                where: { labResultId },
                data: {
                    ...(dto.overallConclusion !== undefined ? { overallConclusion: dto.overallConclusion } : {}),
                    resultStatus: nextResultStatus,
                },
            });

            for (const value of resolvedValues) {
                await tx.labResultValue.upsert({
                    where: { labResultId_parameterId: { labResultId, parameterId: value.parameterId } },
                    create: { labResultId, ...value },
                    update: { valueNumeric: value.valueNumeric, valueText: value.valueText },
                });
            }
        });

        this.eventEmitter.emit(LAB_RESULT_SUBMITTED_EVENT, new LabResultSubmittedEvent(labResultId));

        this.logger.log(`Đã cập nhật kết quả xét nghiệm ${labResultId} (resultStatus: ${nextResultStatus})`);
        return this.getById(labResultId);
    }

    /**
     * Đính kèm thêm tệp/hình ảnh (VD: ảnh X-quang, PDF kết quả gốc từ máy) cho 1 kết quả xét nghiệm.
     * `uploadedByUserId` (lấy từ JWT, xem LabResultController.addAttachment) phải có actorRole LAB_STAFF.
     *
     * Nếu có `file` (multipart, xem LabResultController.addAttachment) thì upload thẳng lên S3 và
     * lấy objectName làm fileUrl — bỏ qua `dto.fileUrl` nếu có. Nếu không có `file`, bắt buộc phải
     * có sẵn `dto.fileUrl` (VD: link kết quả raw_export do hệ thống máy xét nghiệm cung cấp sẵn).
     */
    async addAttachment(
        labResultId: string,
        dto: AddLabAttachmentDto,
        uploadedByUserId: string,
        file?: Express.Multer.File,
    ) {
        await this.actorRoleService.assertActorRole(uploadedByUserId, [ACTOR_ROLE.LAB_STAFF]);

        const labResult = await this.prisma.labResult.findUnique({ where: { labResultId } });
        if (!labResult) {
            throw new NotFoundException(`Không tìm thấy kết quả xét nghiệm ${labResultId}`);
        }

        let fileUrl: string;
        if (file) {
            const uploadResult = await uploadImageToS3(file, 'lab-attachments');
            fileUrl = uploadResult.objectName; // Lưu objectName (vd: lab-attachments/171000-1234.png)
        } else if (dto.fileUrl) {
            fileUrl = dto.fileUrl;
        } else {
            throw new BadRequestException('Phải cung cấp tệp đính kèm (file) hoặc fileUrl có sẵn.');
        }

        const attachment = await this.prisma.labResultAttachment.create({
            data: {
                labResultId,
                fileType: dto.fileType,
                fileUrl,
                description: dto.description,
                uploadedByUserId,
                uploadedAt: new Date(),
            },
        });

        // Có thêm tệp/hình ảnh mới -> dữ liệu đầu vào cho AI thay đổi, kích hoạt lại pipeline nền.
        this.eventEmitter.emit(LAB_RESULT_SUBMITTED_EVENT, new LabResultSubmittedEvent(labResultId));

        return attachment;
    }

    async listAttachments(labResultId: string) {
        return this.prisma.labResultAttachment.findMany({
            where: { labResultId },
            orderBy: { uploadedAt: 'desc' },
        });
    }

    async getById(labResultId: string) {
        const labResult = await this.prisma.labResult.findUnique({
            where: { labResultId },
            include: {
                values: {
                    include: {
                        parameter: {
                            include: { labParameterThresholds: true },
                        },
                        labResultAlerts: true,
                    },
                },
                attachments: true,
                aiLabAnalyses: true,
                labTask: true,
            },
        });
        if (!labResult) {
            throw new NotFoundException(`Không tìm thấy kết quả xét nghiệm ${labResultId}`);
        }
        return labResult;
    }

    async getByLabTaskId(labTaskId: string) {
        const labResult = await this.prisma.labResult.findUnique({
            where: { labTaskId },
            include: {
                values: {
                    include: {
                        parameter: {
                            include: { labParameterThresholds: true },
                        },
                        labResultAlerts: true,
                    },
                },
                attachments: true,
                aiLabAnalyses: true,
            },
        });
        if (!labResult) {
            throw new NotFoundException(`Nhiệm vụ xét nghiệm ${labTaskId} chưa có kết quả.`);
        }
        return labResult;
    }
}