import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { Icd10CatalogService } from '../../shared/icd10-catalog/icd10-catalog.service';
import { DOCTOR_WRITABLE_STATUSES } from '../common/encounter-status.guard';
import { DoctorEncounterAccessService } from '../common/doctor-encounter-access.service';
import { CreateInitialDiagnosisDto } from './dto/create-initial-diagnosis.dto';
import { UpdateInitialDiagnosisDto } from './dto/update-initial-diagnosis.dto';
import { FindDiagnosesQueryDto } from './dto/find-diagnoses-query.dto';

/**
 * SE02 — Chẩn đoán ban đầu (Diagnosis.diagnosisType = 'initial' | 'differential').
 *
 * Diagnosis.doctorId là Doctor.doctorId, không liên kết AI. Chẩn đoán 'final' thuộc SE05
 * (post-test-consultation/diagnosis-conclusion) — module này KHÔNG được sửa/xoá 'final'.
 */
@Injectable()
export class InitialDiagnosisService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly access: DoctorEncounterAccessService,
        private readonly icd10CatalogService: Icd10CatalogService,
    ) {}

    async create(encounterId: string, dto: CreateInitialDiagnosisDto, currentUserId: string) {
        const { doctor, encounter } = await this.access.prepareWrite(
            encounterId,
            currentUserId,
            DOCTOR_WRITABLE_STATUSES,
            'ghi nhận chẩn đoán',
        );

        const icd10 = await this.icd10CatalogService.getByCode(dto.icd10Code);
        if (!icd10.isActive) {
            throw new BadRequestException(`Mã ICD-10 '${dto.icd10Code}' đã ngưng sử dụng, vui lòng chọn mã khác.`);
        }

        const diagnosisType = dto.diagnosisType ?? 'initial';

        return this.prisma.$transaction(async (tx) => {
            // Serialize theo lượt khám: chặn double-click tạo trùng và 2 request cùng đặt "primary".
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`diagnosis:${encounterId}`}))`;

            const duplicate = await tx.diagnosis.findFirst({
                where: { encounterId, diagnosisType, icd10Code: dto.icd10Code },
                select: { diagnosisId: true },
            });
            if (duplicate) {
                throw new ConflictException(
                    `Lượt khám đã có chẩn đoán '${dto.icd10Code}' (loại ${diagnosisType}). Dùng PATCH để sửa thay vì tạo trùng.`,
                );
            }

            const primaryExists =
                (await tx.diagnosis.count({ where: { encounterId, diagnosisType, isPrimary: true } })) > 0;
            const isPrimary = dto.isPrimary ?? !primaryExists;

            // Tối đa 1 chẩn đoán primary cho mỗi (encounter, type): đặt primary mới thì hạ primary cũ.
            if (isPrimary && primaryExists) {
                await tx.diagnosis.updateMany({
                    where: { encounterId, diagnosisType, isPrimary: true },
                    data: { isPrimary: false },
                });
            }

            const created = await tx.diagnosis.create({
                data: {
                    encounterId,
                    icd10Code: dto.icd10Code,
                    diagnosisName: dto.diagnosisName?.trim() || icd10.icd10Name,
                    diagnosisType,
                    doctorId: doctor.doctorId,
                    isPrimary,
                    notes: dto.notes,
                    diagnosedAt: dto.diagnosedAt ? new Date(dto.diagnosedAt) : new Date(),
                },
                include: { icd10: true },
            });

            // Ghi chẩn đoán trước khi nhập phiếu khám vẫn là "bắt đầu khám" — nếu không, bước chỉ định sẽ bị chặn khó hiểu.
            await this.access.startExaminationIfNeeded(tx, encounter, doctor.doctorId);
            return created;
        });
    }

    async update(encounterId: string, diagnosisId: string, dto: UpdateInitialDiagnosisDto, currentUserId: string) {
        const { doctor } = await this.access.prepareWrite(
            encounterId,
            currentUserId,
            DOCTOR_WRITABLE_STATUSES,
            'sửa chẩn đoán',
        );

        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`diagnosis:${encounterId}`}))`;

            const diagnosis = await this.loadEditable(tx, encounterId, diagnosisId);

            if (dto.isPrimary === false && diagnosis.isPrimary) {
                throw new BadRequestException('Không thể bỏ chẩn đoán chính trực tiếp — hãy đặt chẩn đoán khác làm chính.');
            }
            if (dto.isPrimary === true && !diagnosis.isPrimary) {
                await tx.diagnosis.updateMany({
                    where: { encounterId, diagnosisType: diagnosis.diagnosisType, isPrimary: true },
                    data: { isPrimary: false },
                });
            }

            return tx.diagnosis.update({
                where: { diagnosisId },
                data: {
                    ...(dto.diagnosisName?.trim() ? { diagnosisName: dto.diagnosisName.trim() } : {}),
                    ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
                    ...(dto.isPrimary === true ? { isPrimary: true } : {}),
                    doctorId: doctor.doctorId,
                },
                include: { icd10: true },
            });
        });
    }

    async remove(encounterId: string, diagnosisId: string, currentUserId: string) {
        await this.access.prepareWrite(encounterId, currentUserId, DOCTOR_WRITABLE_STATUSES, 'xoá chẩn đoán');

        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`diagnosis:${encounterId}`}))`;

            const diagnosis = await this.loadEditable(tx, encounterId, diagnosisId);

            const usedByOrders = await tx.diagnosticOrder.count({ where: { diagnosisId } });
            if (usedByOrders > 0) {
                throw new ConflictException(
                    'Chẩn đoán này đã là căn cứ của chỉ định cận lâm sàng, không thể xoá. Có thể sửa tên/ghi chú.',
                );
            }

            await tx.diagnosis.delete({ where: { diagnosisId } });
            return { deleted: true, diagnosisId, wasPrimary: diagnosis.isPrimary };
        });
    }

    async findByEncounterId(encounterId: string, query: FindDiagnosesQueryDto) {
        return this.prisma.diagnosis.findMany({
            where: { encounterId, ...(query.diagnosisType ? { diagnosisType: query.diagnosisType } : {}) },
            orderBy: { diagnosedAt: 'desc' },
            include: { icd10: true },
        });
    }

    private async loadEditable(
        tx: Pick<PrismaService, 'diagnosis'>,
        encounterId: string,
        diagnosisId: string,
    ) {
        const diagnosis = await tx.diagnosis.findUnique({ where: { diagnosisId } });
        if (!diagnosis || diagnosis.encounterId !== encounterId) {
            throw new NotFoundException(`Không tìm thấy chẩn đoán ${diagnosisId} trong lượt khám ${encounterId}`);
        }
        if (diagnosis.diagnosisType === 'final') {
            throw new BadRequestException('Chẩn đoán chính thức (final) thuộc bước kết luận sau cận lâm sàng, không sửa/xoá ở đây.');
        }
        return diagnosis;
    }
}
