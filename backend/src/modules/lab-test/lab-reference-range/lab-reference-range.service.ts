import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LabParameterThreshold } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';

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
 * Trả về các dải ngưỡng (normal/low/medium/high/critical) của từng tham số thuộc 1 loại
 * xét nghiệm, tính theo tuổi (tại thời điểm `at`) + giới tính của bệnh nhân — dùng để giao
 * diện kỹ thuật viên hiển thị ngay cạnh ô nhập kết quả, tương tự VitalReferenceRangeService
 * của module vitals nhưng theo cấu trúc nhiều-dải-nguy-cơ của LabParameterThreshold.
 */
@Injectable()
export class LabReferenceRangeService {
    constructor(private readonly prisma: PrismaService) {}

    async getReferenceRanges(
        patientId: string,
        testTypeId: string,
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
        const age = this.calculateAge(patient.dateOfBirth, at);

        const parameters = await this.prisma.labResultParameter.findMany({
            where: { testTypeId, isActive: true },
            orderBy: { displayOrder: 'asc' },
        });

        const results: LabParameterReferenceDto[] = [];
        for (const parameter of parameters) {
            const rows = await this.findApplicableThresholdRows(parameter.parameterId, age, patient.gender, at);
            if (rows.length === 0) continue; // Chưa cấu hình ngưỡng cho tham số này (VD: tham số dạng text).

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

    private calculateAge(dateOfBirth: Date, at: Date): number {
        let age = at.getFullYear() - dateOfBirth.getFullYear();
        const monthDiff = at.getMonth() - dateOfBirth.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && at.getDate() < dateOfBirth.getDate())) {
            age--;
        }
        return age;
    }

    private async findApplicableThresholdRows(
        parameterId: string,
        age: number,
        gender: string | null,
        at: Date,
    ): Promise<LabParameterThreshold[]> {
        const candidates = await this.prisma.labParameterThreshold.findMany({
            where: {
                parameterId,
                isActive: true,
                effectiveFrom: { lte: at },
                AND: [
                    { OR: [{ ageMin: null }, { ageMin: { lte: age } }] },
                    { OR: [{ ageMax: null }, { ageMax: { gte: age } }] },
                ],
                OR: [{ gender: null }, ...(gender ? [{ gender }] : [])],
            },
            orderBy: { effectiveFrom: 'desc' },
        });

        if (candidates.length === 0) return [];

        const preferGendered = gender ? candidates.filter((c) => c.gender === gender) : [];
        const pool = preferGendered.length > 0 ? preferGendered : candidates.filter((c) => !c.gender);
        const effectivePool = pool.length > 0 ? pool : candidates;

        const latestEffectiveFrom = effectivePool[0].effectiveFrom;
        return effectivePool.filter((c) => c.effectiveFrom.getTime() === latestEffectiveFrom.getTime());
    }
}
