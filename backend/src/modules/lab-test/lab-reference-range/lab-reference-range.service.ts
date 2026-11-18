import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { ResultThresholdResolver } from './result-threshold.resolver';

export interface LabParameterReferenceBandDto {
    riskLevel: string;
    rangeMin: number | null;
    rangeMax: number | null;
}

export interface LabParameterReferenceDto {
    parameterId: string;
    parameterCode: string;
    parameterName: string | null;
    unit: string | null;
    bands: LabParameterReferenceBandDto[];
}

/**
 * Trả về các dải ngưỡng (normal/low/medium/high/critical) của từng ResultParameter thuộc 1 dịch vụ cận lâm sàng,
 * tính theo tuổi (tại thời điểm `at`) + giới tính của bệnh nhân — dùng để giao diện kỹ thuật viên hiển thị
 * ngay cạnh ô nhập kết quả. Logic tra ngưỡng dùng chung với bộ phát hiện bất thường (ResultThresholdResolver).
 */
@Injectable()
export class LabReferenceRangeService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly thresholdResolver: ResultThresholdResolver,
    ) {}

    async getReferenceRanges(
        patientId: string,
        serviceId: string,
        atInput?: string,
    ): Promise<LabParameterReferenceDto[]> {
        const patient = await this.prisma.patient.findUnique({
            where: { patientId },
            select: { dateOfBirth: true, gender: true },
        });
        if (!patient) {
            throw new NotFoundException(`Không tìm thấy bệnh nhân ${patientId}`);
        }
        if (!patient.dateOfBirth) {
            throw new BadRequestException('Bệnh nhân chưa có ngày sinh, không thể xác định ngưỡng theo độ tuổi.');
        }

        const at = atInput ? new Date(atInput) : new Date();
        const age = this.thresholdResolver.calculateAge(patient.dateOfBirth, at);

        const parameters = await this.prisma.resultParameter.findMany({
            where: { serviceId, isActive: true },
            orderBy: { displayOrder: 'asc' },
        });

        const results: LabParameterReferenceDto[] = [];
        for (const parameter of parameters) {
            const rows = await this.thresholdResolver.findApplicableRows(parameter.parameterId, age, patient.gender, at);
            if (rows.length === 0) continue; // Chưa cấu hình ngưỡng (vd: tham số dạng text/enum).

            results.push({
                parameterId: parameter.parameterId,
                parameterCode: parameter.parameterCode,
                parameterName: parameter.parameterName,
                unit: parameter.unit,
                bands: rows.map((r) => ({
                    riskLevel: r.riskLevel,
                    rangeMin: r.rangeMin !== null ? Number(r.rangeMin) : null,
                    rangeMax: r.rangeMax !== null ? Number(r.rangeMax) : null,
                })),
            });
        }

        return results;
    }
}
