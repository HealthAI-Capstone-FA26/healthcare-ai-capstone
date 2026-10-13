import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';

const DEFAULT_HISTORY_LIMIT = 20;

/**
 * Các truy vấn phục vụ giao diện điều dưỡng: xem lịch sử đo, lần đo gần nhất
 * (để đối chiếu nhanh khi đang nhập lần mới), và chi tiết 1 lần đo kèm cảnh báo.
 * Tách riêng khỏi VitalInputService (chỉ lo việc ghi) để giữ mỗi service một trách nhiệm.
 */
@Injectable()
export class VitalSessionQueryService {
    constructor(private readonly prisma: PrismaService) { }

    /** Lịch sử ghi nhận sinh hiệu của 1 lượt khám, mới nhất trước — để vẽ bảng/biểu đồ xu hướng. */
    async listByEncounter(encounterId: string, limit = DEFAULT_HISTORY_LIMIT) {
        return this.prisma.vitalSignSession.findMany({
            where: { encounterId },
            orderBy: { measuredAt: 'desc' },
            take: limit,
            include: {
                observations: { include: { item: true } },
            },
        });
    }

    /** Lần đo gần nhất của 1 lượt khám — để điều dưỡng so sánh nhanh với lần đang nhập. */
    async getLatestByEncounter(encounterId: string) {
        const session = await this.prisma.vitalSignSession.findFirst({
            where: { encounterId },
            orderBy: { measuredAt: 'desc' },
            include: {
                observations: { include: { item: true } },
            },
        });

        if (!session) {
            throw new NotFoundException(`Chưa có lần ghi nhận sinh hiệu nào cho encounter ${encounterId}`);
        }

        return session;
    }

    /** Chi tiết 1 lần đo, kèm cảnh báo (nếu có) của từng chỉ số. */
    async getById(vitalSessionId: string) {
        const session = await this.prisma.vitalSignSession.findUnique({
            where: { vitalSessionId },
            include: {
                observations: {
                    include: { item: true, vitalSignAlerts: true },
                },
            },
        });

        if (!session) {
            throw new NotFoundException(`Không tìm thấy phiên ghi nhận sinh hiệu ${vitalSessionId}`);
        }

        return session;
    }
}
