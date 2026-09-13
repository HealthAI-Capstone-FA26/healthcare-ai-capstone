import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ConfirmAlertDto } from './dtos/confirm-alert.dto';

@Injectable()
export class PrescriptionSafetyService {
    constructor(private readonly prisma: PrismaService) {}

    // GET /prescriptions/:id/alerts
    async findAlertsByPrescription(prescriptionId: string) {
        const prescription = await this.prisma.prescription.findUnique({ where: { prescriptionId } });
        if (!prescription) {
            throw new NotFoundException('Không tìm thấy đơn thuốc');
        }

        return this.prisma.prescriptionSafetyAlert.findMany({
            where: { prescriptionId },
            orderBy: { createdAt: 'desc' },
        });
    }

    // PATCH /prescriptions/:id/alerts/:alertId/confirm
    async confirmAlert(prescriptionId: string, alertId: string, dto: ConfirmAlertDto, currentUserId: string) {
        const alert = await this.prisma.prescriptionSafetyAlert.findUnique({ where: { alertId } });

        if (!alert || alert.prescriptionId !== prescriptionId) {
            throw new NotFoundException('Không tìm thấy cảnh báo an toàn cho đơn thuốc này');
        }

        return this.prisma.prescriptionSafetyAlert.update({
            where: { alertId },
            data: {
                status: 'confirmed',
                overrideReason: dto.overrideReason,
                confirmedByUserId: currentUserId,
                confirmedAt: new Date(),
            },
        });
    }
}
