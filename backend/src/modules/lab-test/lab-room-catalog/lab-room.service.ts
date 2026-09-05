import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';

/**
 * Danh mục phòng Lab (Huyết học, Sinh hoá, Chẩn đoán hình ảnh, ...) và phân quyền
 * kỹ thuật viên theo từng phòng — dùng để dựng worklist theo phòng và kiểm tra
 * kỹ thuật viên có được phép thao tác trên 1 LabTask thuộc phòng đó hay không.
 */
@Injectable()
export class LabRoomService {
    constructor(private readonly prisma: PrismaService) {}

    async listActive() {
        return this.prisma.labRoom.findMany({
            where: { isActive: true },
            orderBy: { labRoomName: 'asc' },
        });
    }

    async listStaffAssignments(labRoomId: string) {
        return this.prisma.labStaffRoomAssignment.findMany({
            where: { labRoomId },
            include: { user: true },
        });
    }

    /**
     * Kiểm tra 1 kỹ thuật viên có được phân công vào phòng Lab tương ứng hay không.
     * Dùng làm guard nghiệp vụ ở LabTaskService trước khi cho gán/nhận nhiệm vụ.
     */
    async isStaffAssignedToRoom(userId: string, labRoomId: string): Promise<boolean> {
        const assignment = await this.prisma.labStaffRoomAssignment.findUnique({
            where: { userId_labRoomId: { userId, labRoomId } },
        });
        return !!assignment;
    }
}
