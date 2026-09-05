import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { LabPatientContext } from './lab-result-detector.interface';

/**
 * Tra cứu ngữ cảnh bệnh nhân (ngày sinh, giới tính, encounterId) từ 1 LabResult — cần để
 * tính tuổi khi tra ngưỡng (LabParameterThreshold) và biết push cảnh báo realtime vào room nào.
 *
 * ⚠️ QUAN TRỌNG — CẦN ĐIỀU CHỈNH TRƯỚC KHI DÙNG:
 * schema.prisma cung cấp cho module Lab-test không bao gồm định nghĩa đầy đủ của
 * TestOrderItem / TestOrder / Encounter / Patient (các model này thuộc module khác).
 * Đoạn bên dưới viết theo giả định hợp lý nhất (LabTask -> orderItem -> testOrder -> encounter
 * -> patient), tương tự cách VitalSignSession lưu thẳng encounterId + patientId ở module vitals.
 * Đội ngũ dev cần sửa lại đúng theo tên quan hệ/field thật trong schema đầy đủ của hệ thống
 * (chỉ cần sửa trong file này — không ảnh hưởng phần còn lại của module Lab-test).
 */
@Injectable()
export class LabPatientContextResolver {
    constructor(private readonly prisma: PrismaService) {}

    async resolve(labResultId: string): Promise<LabPatientContext> {
        const labResult = await this.prisma.labResult.findUniqueOrThrow({
            where: { labResultId },
            include: {
                labTask: { include: { orderItem: true } },
            },
        });

        // TODO: thay bằng truy vấn thật, ví dụ:
        //
        // const orderItem = await this.prisma.testOrderItem.findUniqueOrThrow({
        //     where: { orderItemId: labResult.labTask.orderItemId },
        //     include: { testOrder: { include: { encounter: { include: { patient: true } } } } },
        // });
        // return {
        //     dateOfBirth: orderItem.testOrder.encounter.patient.dateOfBirth,
        //     gender: orderItem.testOrder.encounter.patient.gender,
        //     encounterId: orderItem.testOrder.encounterId,
        // };

        const orderItem = labResult.labTask.orderItem as unknown as Record<string, unknown>;
        const encounterId = orderItem?.encounterId as string | undefined;

        if (!encounterId) {
            throw new Error(
                'LabPatientContextResolver: không tìm thấy encounterId cho LabResult ' +
                    `${labResultId}. Cần nối đúng quan hệ TestOrderItem -> Encounter -> Patient thật của hệ thống ` +
                    '(chỉnh sửa trong lab-patient-context.resolver.ts).',
            );
        }

        // Best-effort — nếu Patient chưa được include, coi như chưa xác định được tuổi/giới tính
        // (detector sẽ báo "chưa cấu hình ngưỡng áp dụng" thay vì tính sai).
        return {
            dateOfBirth: (orderItem?.patient as { dateOfBirth?: Date })?.dateOfBirth ?? null,
            gender: (orderItem?.patient as { gender?: string })?.gender ?? null,
            encounterId,
        };
    }
}
