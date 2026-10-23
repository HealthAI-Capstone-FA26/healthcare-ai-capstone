import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { generateUniqueCode } from '../../../../common/utils/code-generator.util';
import { EncounterStatus } from '../../../../common/utils/encounter-status.util';
import { ACTOR_ROLE } from '../../../../common/constants/actor-role.constant';
import { RequestUser } from '../../../identity-access/auth/strategies/jwt.strategy';
import { DoctorService } from '../../../identity-access/doctor/doctor.service';
import { ActorRoleService } from '../../../identity-access/user/actor-role.service';
import { PrescriptionSafetyCheckOrchestrator } from '../prescription-safety/orchestrators/prescription-safety-check.orchestrator';
import { CreatePrescriptionDto } from './dtos/create-prescription.dto';
import { UpdatePrescriptionItemsDto } from './dtos/update-prescription-items.dto';
import { PrescriptionItemDto } from './dtos/prescription-item.dto';
import { FindPrescriptionsQueryDto } from './dtos/find-prescriptions-query.dto';

const PRESCRIPTION_CODE_PREFIX = 'DT'; // "Đơn Thuốc"

export const PRESCRIPTION_INCLUDE = {
    items: {
        include: {
            drug: {
                include: { allergenCategory: true },
            },
        },
    },
    safetyAlerts: {
        orderBy: { createdAt: 'desc' },
    },
    doctor: true,
    diagnosis: {
        include: { icd10: true },
    },
    encounter: {
        include: { patient: true },
    },
} satisfies Prisma.PrescriptionInclude;

@Injectable()
export class PrescriptionService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly doctorService: DoctorService,
        private readonly actorRoleService: ActorRoleService,
        private readonly safetyCheckOrchestrator: PrescriptionSafetyCheckOrchestrator,
    ) { }

    private generatePrescriptionCode(): Promise<string> {
        return generateUniqueCode(PRESCRIPTION_CODE_PREFIX, async (code) => {
            const existing = await this.prisma.prescription.findUnique({
                where: { prescriptionCode: code },
            });
            return Boolean(existing);
        });
    }

    private async resolveCurrentDoctor(currentUser: RequestUser) {
        await this.actorRoleService.assertActorRole(currentUser.userId, [ACTOR_ROLE.DOCTOR]);
        return this.doctorService.findByUserId(currentUser.userId);
    }

    private async validateDrugItems(items: PrescriptionItemDto[]) {
        const drugIds = [...new Set(items.map((item) => item.drugId))];
        const drugs = await this.prisma.drugCatalog.findMany({
            where: { drugId: { in: drugIds } },
        });
        const drugMap = new Map(drugs.map((d) => [d.drugId, d]));

        for (const item of items) {
            const drug = drugMap.get(item.drugId);
            if (!drug) {
                throw new BadRequestException(`Thuốc với ID "${item.drugId}" không tồn tại trong danh mục`);
            }
            if (!drug.isActive) {
                throw new BadRequestException(`Thuốc "${drug.drugName}" (${drug.drugCode}) đã ngừng lưu hành`);
            }
        }
    }

    // POST /prescriptions
    async create(dto: CreatePrescriptionDto, currentUser: RequestUser) {
        const doctor = await this.resolveCurrentDoctor(currentUser);

        const diagnosis = await this.prisma.diagnosis.findUnique({ where: { diagnosisId: dto.diagnosisId } });
        if (!diagnosis) {
            throw new NotFoundException('Không tìm thấy chẩn đoán');
        }
        if (diagnosis.encounterId !== dto.encounterId) {
            throw new BadRequestException('Chẩn đoán không thuộc lượt khám (encounter) đã truyền');
        }
        if (diagnosis.doctorId !== doctor.doctorId) {
            throw new ForbiddenException('Bạn chỉ có thể kê đơn dựa trên chẩn đoán do chính mình ghi nhận');
        }
        if (diagnosis.diagnosisType !== 'final') {
            throw new BadRequestException(
                `Chẩn đoán để kê đơn phải là chẩn đoán chính thức (diagnosisType='final'), hiện tại là '${diagnosis.diagnosisType}'.`,
            );
        }

        const encounter = await this.prisma.encounter.findUnique({ where: { encounterId: dto.encounterId } });
        if (!encounter) {
            throw new NotFoundException('Không tìm thấy lượt khám');
        }
        if (encounter.doctorId && encounter.doctorId !== doctor.doctorId) {
            throw new ForbiddenException('Bạn chỉ có thể kê đơn cho lượt khám do chính mình phụ trách');
        }
        if (encounter.status !== EncounterStatus.AWAITING_REVIEW) {
            throw new ForbiddenException(
                `Chỉ có thể kê đơn khi lượt khám ở trạng thái '${EncounterStatus.AWAITING_REVIEW}', hiện tại là '${encounter.status}'.`,
            );
        }

        await this.validateDrugItems(dto.items);
        const prescriptionCode = await this.generatePrescriptionCode();

        const prescription = await this.prisma.$transaction(async (tx) => {
            return tx.prescription.create({
                data: {
                    prescriptionCode,
                    encounterId: dto.encounterId,
                    diagnosisId: dto.diagnosisId,
                    doctorId: doctor.doctorId,
                    status: 'draft',
                    items: {
                        create: dto.items.map((item) => ({
                            drugId: item.drugId,
                            quantity: new Prisma.Decimal(item.quantity),
                            dosage: item.dosage,
                            routeCode: item.routeCode,
                            routeSystem: item.routeSystem,
                            routeDisplay: item.routeDisplay,
                            frequency: item.frequency,
                            durationDays: item.durationDays,
                            instruction: item.instruction,
                        })),
                    },
                },
                include: PRESCRIPTION_INCLUDE,
            });
        });

        // Chạy đồng bộ Safety Check ngay sau khi tạo đơn
        await this.safetyCheckOrchestrator.run(prescription.prescriptionId);

        return this.findById(prescription.prescriptionId);
    }

    // PATCH /prescriptions/:id/items — thay toàn bộ danh sách item, chỉ cho phép khi status=draft
    async updateItems(prescriptionId: string, dto: UpdatePrescriptionItemsDto, currentUser: RequestUser) {
        const doctor = await this.resolveCurrentDoctor(currentUser);
        const prescription = await this.prisma.prescription.findUnique({ where: { prescriptionId } });

        if (!prescription) {
            throw new NotFoundException('Không tìm thấy đơn thuốc');
        }
        if (prescription.doctorId !== doctor.doctorId) {
            throw new ForbiddenException('Bạn chỉ có thể chỉnh sửa đơn thuốc do chính mình kê');
        }
        if (prescription.status !== 'draft') {
            throw new ForbiddenException(
                `Đơn thuốc đang ở trạng thái "${prescription.status}", chỉ có thể chỉnh sửa khi còn ở trạng thái nháp (draft)`,
            );
        }

        await this.validateDrugItems(dto.items);

        await this.prisma.$transaction(async (tx) => {
            await tx.prescriptionItem.deleteMany({ where: { prescriptionId } });
            return tx.prescription.update({
                where: { prescriptionId },
                data: {
                    items: {
                        create: dto.items.map((item) => ({
                            drugId: item.drugId,
                            quantity: new Prisma.Decimal(item.quantity),
                            dosage: item.dosage,
                            routeCode: item.routeCode,
                            routeSystem: item.routeSystem,
                            routeDisplay: item.routeDisplay,
                            frequency: item.frequency,
                            durationDays: item.durationDays,
                            instruction: item.instruction,
                        })),
                    },
                },
                include: PRESCRIPTION_INCLUDE,
            });
        });

        // Chạy lại Safety Check sau khi cập nhật danh sách thuốc
        await this.safetyCheckOrchestrator.run(prescriptionId);

        return this.findById(prescriptionId);
    }

    // POST /prescriptions/:id/cancel
    async cancel(prescriptionId: string, currentUser: RequestUser) {
        const doctor = await this.resolveCurrentDoctor(currentUser);
        const prescription = await this.prisma.prescription.findUnique({ where: { prescriptionId } });

        if (!prescription) {
            throw new NotFoundException('Không tìm thấy đơn thuốc');
        }
        if (prescription.doctorId !== doctor.doctorId) {
            throw new ForbiddenException('Bạn chỉ có thể huỷ đơn thuốc do chính mình kê');
        }
        if (prescription.status === 'cancelled') {
            throw new BadRequestException('Đơn thuốc này đã ở trạng thái huỷ');
        }

        return this.prisma.prescription.update({
            where: { prescriptionId },
            data: { status: 'cancelled' },
            include: PRESCRIPTION_INCLUDE,
        });
    }

    // PATCH /prescriptions/:id/printed
    async markAsPrinted(prescriptionId: string) {
        const prescription = await this.prisma.prescription.findUnique({ where: { prescriptionId } });
        if (!prescription) {
            throw new NotFoundException('Không tìm thấy đơn thuốc');
        }

        return this.prisma.prescription.update({
            where: { prescriptionId },
            data: { printedAt: new Date() },
            include: PRESCRIPTION_INCLUDE,
        });
    }

    // GET /prescriptions/:id
    async findById(prescriptionId: string) {
        const prescription = await this.prisma.prescription.findUnique({
            where: { prescriptionId },
            include: PRESCRIPTION_INCLUDE,
        });

        if (!prescription) {
            throw new NotFoundException('Không tìm thấy đơn thuốc');
        }
        return prescription;
    }

    // GET /prescriptions
    findMany(query: FindPrescriptionsQueryDto) {
        const where: Prisma.PrescriptionWhereInput = {};
        if (query.encounterId) {
            where.encounterId = query.encounterId;
        }
        if (query.doctorId) {
            where.doctorId = query.doctorId;
        }
        if (query.status) {
            where.status = query.status;
        }

        return this.prisma.prescription.findMany({
            where,
            include: PRESCRIPTION_INCLUDE,
            orderBy: { createdAt: 'desc' },
        });
    }
}
