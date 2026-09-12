import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { calculateAge, findApplicableThreshold } from '../common/vital-threshold.utils';
import { calculateAgeInMonths, getBmiNormalRange, normalizePatientSex } from '../common/pediatric-bmi.utils';

const BMI_ITEM_CODE = 'BMI';

export interface VitalReferenceRangeDto {
    itemCode: string;
    itemName: string;
    unit: string;
    minNormal: number;
    maxNormal: number;
    sourceReference: string | null;
}

/**
 * Trả về khoảng bình thường của từng chỉ số sinh hiệu áp dụng cho 1 bệnh nhân cụ thể (theo
 * tuổi tại thời điểm đo + giới tính). Dùng để giao diện điều dưỡng hiển thị ngay cạnh ô nhập
 * liệu (VD: "HA tâm thu: bình thường 90–119 mmHg") — không cần đợi submit mới biết chỉ số có
 * bất thường hay không.
 *
 * Không còn minCritical/maxCritical: chỉ có 1 khoảng normal duy nhất, ra khỏi khoảng này là
 * bất thường (xem rule-based.detector.ts). Dùng chung calculateAge/findApplicableThreshold với
 * detector qua common/vital-threshold.utils.ts để 2 nơi không lệch nhau.
 */
@Injectable()
export class VitalReferenceRangeService {
    constructor(private readonly prisma: PrismaService) { }

    async getReferenceRanges(patientId: string, measuredAtInput?: string): Promise<VitalReferenceRangeDto[]> {
        const patient = await this.prisma.patient.findUnique({
            where: { patientId },
            select: { dateOfBirth: true, gender: true },
        });

        if (!patient) {
            throw new NotFoundException(`Không tìm thấy bệnh nhân ${patientId}`);
        }
        if (!patient.dateOfBirth) {
            throw new BadRequestException(
                'Bệnh nhân chưa có ngày sinh, không thể xác định khoảng bình thường theo độ tuổi.',
            );
        }

        const measuredAt = measuredAtInput ? new Date(measuredAtInput) : new Date();
        const age = calculateAge(patient.dateOfBirth, measuredAt);

        const items = await this.prisma.vitalSignItem.findMany({ where: { isActive: true } });

        const ranges: VitalReferenceRangeDto[] = [];
        for (const item of items) {
            // BMI không tra bảng VitalSignThreshold như các chỉ số khác: khoảng bình thường của
            // BMI phụ thuộc liên tục vào tuổi (đặc biệt ở trẻ em) nên không thể mô tả bằng vài
            // dải ageMin/ageMax cố định. Với trẻ 2–<20 tuổi, dùng percentile BMI-for-age theo
            // chuẩn CDC (5th–85th percentile, cùng phương pháp peditools.org/growthpedi và BCM
            // BMI-calculator-kids); với >=20 tuổi, dùng ngưỡng BMI người lớn cố định (18.5–24.9).
            if (item.itemCode === BMI_ITEM_CODE) {
                const ageMonths = calculateAgeInMonths(patient.dateOfBirth, measuredAt);
                const sex = normalizePatientSex(patient.gender);
                const bmiRange = getBmiNormalRange(ageMonths, sex);
                if (!bmiRange) continue; // <2 tuổi (chưa áp dụng BMI-for-age) hoặc thiếu giới tính để tra percentile.

                ranges.push({
                    itemCode: item.itemCode,
                    itemName: item.itemName,
                    unit: item.unit,
                    minNormal: bmiRange.minNormal,
                    maxNormal: bmiRange.maxNormal,
                    sourceReference: bmiRange.sourceReference,
                });
                continue;
            }

            const threshold = await findApplicableThreshold(this.prisma, item.itemId, age, patient.gender, measuredAt);
            if (!threshold) continue; // Chỉ số chưa có ngưỡng cấu hình (VD: HEIGHT, WEIGHT) — bỏ qua.

            ranges.push({
                itemCode: item.itemCode,
                itemName: item.itemName,
                unit: item.unit,
                minNormal: Number(threshold.minNormal),
                maxNormal: Number(threshold.maxNormal),
                sourceReference: threshold.sourceReference,
            });
        }

        return ranges;
    }
}
