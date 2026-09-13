import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { generateUniqueCode } from '../../../common/utils/code-generator.util';
import { EncounterStatus } from '../../../common/utils/encounter-status.util';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { DoctorService } from '../../doctor/doctor.service';
import { PrescriptionSafetyCheckOrchestrator } from '../prescription-safety/orchestrators/prescription-safety-check.orchestrator';
import { CreatePrescriptionDto } from './dtos/create-prescription.dto';
import { UpdatePrescriptionItemsDto } from './dtos/update-prescription-items.dto';
import { PrescriptionItemDto } from './dtos/prescription-item.dto';
import { FindPrescriptionsQueryDto } from './dtos/find-prescriptions-query.dto';

const PRESCRIPTION_CODE_PREFIX = 'DT'; // "Đơn Thuốc" — theo cùng quy ước 2 ký tự với BN/LH/BS/LK

const PRESCRIPTION_INCLUDE = {
    items: { include: { drug: true } },
    safetyAlerts: true,
} satisfies Prisma.PrescriptionInclude;

@Injectable()
export class PrescriptionService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly doctorService: DoctorService,
        private readonly safetyCheckOrchestrator: PrescriptionSafetyCheckOrchestrator,
    ) {}

    private generatePrescriptionCode(): Promise<string> {
        return generateUniqueCode(PRESCRIPTION_CODE_PREFIX, async (code) => {
            const existing = await this.prisma.prescription.findUnique({
                where: { prescriptionCode: code },
            });
            return Boolean(existing);
        });
    }

    // Bác sĩ đang đăng nhập chỉ được thao tác trên đơn thuộc encounter mình phụ trách —
    // resolve Doctor record từ userId trong JWT (JWT không có sẵn doctorId).
    private async resolveCurrentDoctor(currentUser: RequestUser) {
        return this.doctorService.findByUserId(currentUser.userId);
    }

    // Snapshot unitPrice = DrugCatalog.price tại thời điểm kê, không tham chiếu động, tránh vỡ
    // giá lịch sử khi giá thuốc đổi sau này. Đồng thời validate mọi drugId đều tồn tại & isActive.
    private async resolveItemsWithSnapshotPrice(items: PrescriptionItemDto[]) {
        const drugIds = [...new Set(items.map((item) => item.drugId))];
        const drugs = await this.prisma.drugCatalog.findMany({ where: { drugId: { in: drugIds } } });
        const drugMap = new Map(drugs.map((d) => [d.drugId, d]));

        return items.map((item) => {
            const drug = drugMap.get(item.drugId);
            if (!drug || !drug.isActive) {
                throw new BadRequestException(`Thuốc với ID "${item.drugId}" không tồn tại hoặc đã ngừng lưu hành`);
            }

            return {
                drugId: item.drugId,
                quantity: item.quantity,
                dosage: item.dosage,
                routeCode: item.routeCode,
                routeDisplay: item.routeDisplay,
                frequency: item.frequency,
                durationDays: item.durationDays,
                instruction: item.instruction,
                unitPrice: drug.price,
            };
        });
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

        const encounter = await this.prisma.encounter.findUnique({ where: { encounterId: dto.encounterId } });
        if (!encounter) {
            throw new NotFoundException('Không tìm thấy lượt khám');
        }
        if (encounter.doctorId !== doctor.doctorId) {
            throw new ForbiddenException('Bạn chỉ có thể kê đơn cho lượt khám do chính mình phụ trách');
        }
        if (encounter.status === EncounterStatus.FINISHED || encounter.status === EncounterStatus.CANCELLED) {
            throw new ForbiddenException('Lượt khám đã kết thúc hoặc đã huỷ, không thể kê đơn mới');
        }

        const itemsWithPrice = await this.resolveItemsWithSnapshotPrice(dto.items);
        const prescriptionCode = await this.generatePrescriptionCode();

        const prescription = await this.prisma.$transaction(async (tx) => {
            return tx.prescription.create({
                data: {
                    prescriptionCode,
                    encounterId: dto.encounterId,
                    diagnosisId: dto.diagnosisId,
                    doctorId: doctor.doctorId,
                    status: 'draft',
                    issuedAt: new Date(),
                    items: { create: itemsWithPrice },
                },
                include: PRESCRIPTION_INCLUDE,
            });
        });

        // Safety Check chạy đồng bộ ngay sau khi commit transaction tạo item (quyết định 2-A).
        await this.safetyCheckOrchestrator.run(prescription.prescriptionId);

        return this.findById(prescription.prescriptionId);
    }

    // PATCH /prescriptions/:id/items — thay toàn bộ danh sách item, chỉ cho phép khi status=draft.
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

        const itemsWithPrice = await this.resolveItemsWithSnapshotPrice(dto.items);

        await this.prisma.$transaction(async (tx) => {
            await tx.prescriptionItem.deleteMany({ where: { prescriptionId } });
            return tx.prescription.update({
                where: { prescriptionId },
                data: { items: { create: itemsWithPrice } },
                include: PRESCRIPTION_INCLUDE,
            });
        });

        // Safety Check chạy đồng bộ ngay sau khi commit transaction ghi lại item: xoá alert cũ
        // status=active của đơn này, chạy lại 3 detector, ghi alert mới (quyết định 2-A).
        await this.safetyCheckOrchestrator.run(prescriptionId);

        return this.findById(prescriptionId);
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

    // GET /prescriptions?encounterId=xxx
    findMany(query: FindPrescriptionsQueryDto) {
        return this.prisma.prescription.findMany({
            where: { encounterId: query.encounterId },
            include: PRESCRIPTION_INCLUDE,
            orderBy: { createdAt: 'desc' },
        });
    }
}
