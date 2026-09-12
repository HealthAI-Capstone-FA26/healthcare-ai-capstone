import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VitalSignItem, VitalSignObservation } from '@prisma/client';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { RecordVitalSignsDto } from '../dtos/record-vital-signs.dto';
import { UpdateVitalSignsDto } from '../dtos/update-vital-signs.dto';
import { VitalMeasurementsDto } from '../dtos/vital-measurements.dto';
import { VITAL_ITEM_CODE } from '../../../../common/constants/vital-item-code.constant';
import {
    VitalSessionCreatedEvent,
    VITAL_SESSION_CREATED_EVENT,
} from '../../vital-anomaly/vital-session-created.event';

interface PendingObservation {
    itemCode: string;
    value: number;
}

type ObservationWithItem = VitalSignObservation & { item: VitalSignItem };

/**
 * Ghi nhận chỉ số sinh hiệu / thể trạng của bệnh nhân (do Điều dưỡng thực hiện):
 * mạch, huyết áp, nhiệt độ, nhịp thở, SpO2, chiều cao, cân nặng — và tự động tính
 * BMI nếu có đủ chiều cao + cân nặng.
 *
 * Sau khi lưu VitalSignSession + observations thành công, emit event
 * 'vital-session.created' để VitalSignDetectionListener (module vital-anomaly)
 * chạy phát hiện bất thường (rule/ai) ở background — không block response ở đây.
 */
@Injectable()
export class VitalInputService {
    private readonly logger = new Logger(VitalInputService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    async recordVitalSigns(dto: RecordVitalSignsDto) {
        const observations = this.buildObservations(dto);

        if (observations.length === 0) {
            throw new BadRequestException(
                'Cần nhập ít nhất một chỉ số sinh hiệu hoặc thể trạng (mạch, huyết áp, nhiệt độ, nhịp thở, SpO2, chiều cao, cân nặng).',
            );
        }

        const isUuid = (str?: string) =>
            Boolean(str && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str));

        let targetEncounterId = dto.encounterId;
        let targetPatientId = dto.patientId;
        let targetRecordedByUserId = isUuid(dto.recordedByUserId)
            ? dto.recordedByUserId
            : '00000000-0000-0000-0000-000000000000';

        // Lookup encounter by UUID or encounterCode
        const encounter = await this.prisma.encounter.findFirst({
            where: {
                OR: [
                    ...(isUuid(dto.encounterId) ? [{ encounterId: dto.encounterId }] : []),
                    { encounterCode: dto.encounterId },
                ],
            },
        });

        if (encounter) {
            targetEncounterId = encounter.encounterId;
            targetPatientId = encounter.patientId;
        } else {
            // Lookup patient by UUID or patientCode if encounter was not found
            const patient = await this.prisma.patient.findFirst({
                where: {
                    OR: [
                        ...(isUuid(dto.patientId) ? [{ patientId: dto.patientId }] : []),
                        { patientCode: dto.patientId },
                    ],
                },
            });

            if (patient) {
                targetPatientId = patient.patientId;
            }

            if (!isUuid(targetEncounterId)) {
                // Check if patient has any existing encounter
                const latestEnc = await this.prisma.encounter.findFirst({
                    where: { patientId: targetPatientId },
                    orderBy: { arrivedAt: 'desc' },
                });
                if (latestEnc) {
                    targetEncounterId = latestEnc.encounterId;
                } else {
                    targetEncounterId = '00000000-0000-0000-0000-000000000000';
                }
            }

            if (!isUuid(targetPatientId)) {
                targetPatientId = '00000000-0000-0000-0000-000000000000';
            }
        }

        const itemCodes = observations.map((o) => o.itemCode);
        const items = await this.prisma.vitalSignItem.findMany({
            where: { itemCode: { in: itemCodes }, isActive: true },
        });

        const itemByCode = new Map(items.map((i) => [i.itemCode, i]));
        const missingCodes = itemCodes.filter((code) => !itemByCode.has(code));
        if (missingCodes.length > 0) {
            throw new BadRequestException(
                `Danh mục chỉ số sinh hiệu chưa được cấu hình cho mã: ${missingCodes.join(', ')}. Vui lòng liên hệ quản trị hệ thống.`,
            );
        }

        const measuredAt = dto.measuredAt ? new Date(dto.measuredAt) : new Date();

        const session = await this.prisma.vitalSignSession.create({
            data: {
                encounterId: targetEncounterId,
                patientId: targetPatientId,
                recordedByUserId: targetRecordedByUserId,
                measuredAt,
                notes: dto.notes,
                observations: {
                    create: observations.map((o) => ({
                        itemId: itemByCode.get(o.itemCode)!.itemId,
                        observationValue: o.value,
                    })),
                },
            },
            include: {
                observations: { include: { item: true } },
            },
        });

        // Fire-and-forget: không await — tránh làm chậm response ghi nhận sinh hiệu của điều dưỡng.
        this.eventEmitter.emit(
            VITAL_SESSION_CREATED_EVENT,
            new VitalSessionCreatedEvent(session.vitalSessionId),
        );

        this.logger.log(
            `Đã ghi nhận ${observations.length} chỉ số cho encounter ${targetEncounterId} (session ${session.vitalSessionId})`,
        );

        return session;
    }

    /**
     * Sửa lại chỉ số đã nhập sai hoặc bổ sung chỉ số còn thiếu cho 1 lần đo đã lưu.
     * Chỉ field được gửi lên (khác undefined) mới bị thay đổi — field không gửi giữ nguyên.
     * BMI được tính lại tự động nếu height hoặc weight thay đổi (dùng giá trị mới nếu có,
     * không thì lấy lại giá trị cũ đã lưu trong session).
     *
     * Sau khi cập nhật, emit lại đúng event 'vital-session.created' để
     * VitalSignDetectionListener chạy lại detection — orchestrator vốn đã idempotent
     * (ghi đè isAbnormal, chỉ tạo alert mới nếu chưa có alert active) nên tái dùng an toàn.
     */
    async updateVitalSigns(vitalSessionId: string, dto: UpdateVitalSignsDto) {
        const session = await this.prisma.vitalSignSession.findUnique({
            where: { vitalSessionId },
            include: { observations: { include: { item: true } } },
        });

        if (!session) {
            throw new NotFoundException(`Không tìm thấy phiên ghi nhận sinh hiệu ${vitalSessionId}`);
        }

        const existingByCode = new Map<string, ObservationWithItem>(
            session.observations.map((o) => [o.item.itemCode, o]),
        );

        const changes = this.buildObservations(dto);

        // Xác định height/weight hiệu lực (mới nếu có, không thì lấy giá trị đã lưu) để tính lại BMI.
        const effectiveHeight = dto.height ?? this.getExistingValue(existingByCode, VITAL_ITEM_CODE.HEIGHT);
        const effectiveWeight = dto.weight ?? this.getExistingValue(existingByCode, VITAL_ITEM_CODE.WEIGHT);
        if (
            (dto.height !== undefined || dto.weight !== undefined) &&
            effectiveHeight !== undefined &&
            effectiveWeight !== undefined
        ) {
            const bmiValue = this.calculateBmi(effectiveHeight, effectiveWeight);
            const existingBmiChange = changes.find((c) => c.itemCode === VITAL_ITEM_CODE.BMI);
            if (existingBmiChange) {
                existingBmiChange.value = bmiValue;
            } else {
                changes.push({ itemCode: VITAL_ITEM_CODE.BMI, value: bmiValue });
            }
        }

        if (changes.length === 0 && dto.notes === undefined && dto.measuredAt === undefined) {
            throw new BadRequestException('Không có thay đổi nào được gửi lên.');
        }

        // Với chỉ số lần đầu được bổ sung (chưa từng có observation trong session), cần tra itemId.
        const codesNeedingItem = changes.map((c) => c.itemCode).filter((code) => !existingByCode.has(code));
        const newItems = codesNeedingItem.length
            ? await this.prisma.vitalSignItem.findMany({
                where: { itemCode: { in: codesNeedingItem }, isActive: true },
            })
            : [];
        const newItemByCode = new Map(newItems.map((i) => [i.itemCode, i]));
        const missingCodes = codesNeedingItem.filter((code) => !newItemByCode.has(code));
        if (missingCodes.length > 0) {
            throw new BadRequestException(
                `Danh mục chỉ số sinh hiệu chưa được cấu hình cho mã: ${missingCodes.join(', ')}. Vui lòng liên hệ quản trị hệ thống.`,
            );
        }

        await this.prisma.$transaction(async (tx) => {
            if (dto.notes !== undefined || dto.measuredAt !== undefined) {
                await tx.vitalSignSession.update({
                    where: { vitalSessionId },
                    data: {
                        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
                        ...(dto.measuredAt !== undefined ? { measuredAt: new Date(dto.measuredAt) } : {}),
                    },
                });
            }

            for (const change of changes) {
                const existing = existingByCode.get(change.itemCode);
                if (existing) {
                    await tx.vitalSignObservation.update({
                        where: { observationId: existing.observationId },
                        data: { observationValue: change.value },
                    });
                } else {
                    const item = newItemByCode.get(change.itemCode)!;
                    await tx.vitalSignObservation.create({
                        data: { vitalSessionId, itemId: item.itemId, observationValue: change.value },
                    });
                }
            }
        });

        this.eventEmitter.emit(
            VITAL_SESSION_CREATED_EVENT,
            new VitalSessionCreatedEvent(vitalSessionId),
        );

        this.logger.log(`Đã cập nhật ${changes.length} chỉ số cho session ${vitalSessionId}`);

        return this.prisma.vitalSignSession.findUniqueOrThrow({
            where: { vitalSessionId },
            include: { observations: { include: { item: true } } },
        });
    }

    private getExistingValue(map: Map<string, ObservationWithItem>, itemCode: string): number | undefined {
        const obs = map.get(itemCode);
        return obs ? Number(obs.observationValue) : undefined;
    }

    /**
     * Gom các chỉ số điều dưỡng nhập thành danh sách observation cần tạo/cập nhật.
     * Chỉ những field thực sự được truyền lên (khác undefined) mới được đưa vào —
     * cho phép điều dưỡng nhập/sửa từng phần thay vì bắt buộc đủ 7 chỉ số mỗi lần.
     * Dùng chung cho cả tạo mới (RecordVitalSignsDto) và cập nhật (UpdateVitalSignsDto).
     */
    private buildObservations(dto: VitalMeasurementsDto): PendingObservation[] {
        const observations: PendingObservation[] = [];

        if (dto.pulse !== undefined) {
            observations.push({ itemCode: VITAL_ITEM_CODE.PULSE, value: dto.pulse });
        }
        if (dto.systolicBp !== undefined) {
            observations.push({ itemCode: VITAL_ITEM_CODE.BP_SYSTOLIC, value: dto.systolicBp });
        }
        if (dto.diastolicBp !== undefined) {
            observations.push({ itemCode: VITAL_ITEM_CODE.BP_DIASTOLIC, value: dto.diastolicBp });
        }
        if (dto.temperature !== undefined) {
            observations.push({ itemCode: VITAL_ITEM_CODE.TEMPERATURE, value: dto.temperature });
        }
        if (dto.respiratoryRate !== undefined) {
            observations.push({ itemCode: VITAL_ITEM_CODE.RESPIRATORY_RATE, value: dto.respiratoryRate });
        }
        if (dto.spo2 !== undefined) {
            observations.push({ itemCode: VITAL_ITEM_CODE.SPO2, value: dto.spo2 });
        }
        if (dto.height !== undefined) {
            observations.push({ itemCode: VITAL_ITEM_CODE.HEIGHT, value: dto.height });
        }
        if (dto.weight !== undefined) {
            observations.push({ itemCode: VITAL_ITEM_CODE.WEIGHT, value: dto.weight });
        }

        // Tự động tính BMI nếu có đủ chiều cao + cân nặng — điều dưỡng không cần nhập tay.
        if (dto.height !== undefined && dto.weight !== undefined) {
            observations.push({
                itemCode: VITAL_ITEM_CODE.BMI,
                value: this.calculateBmi(dto.height, dto.weight),
            });
        }

        return observations;
    }

    /** BMI = cân nặng (kg) / (chiều cao (m))^2, làm tròn 2 chữ số thập phân. */
    private calculateBmi(heightCm: number, weightKg: number): number {
        const heightM = heightCm / 100;
        const bmi = weightKg / (heightM * heightM);
        return Math.round(bmi * 100) / 100;
    }
}
