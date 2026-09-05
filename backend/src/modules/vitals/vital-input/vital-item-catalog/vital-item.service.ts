import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';

/**
 * Danh mục chỉ số sinh hiệu / thể trạng đang active — giao diện điều dưỡng dùng để
 * dựng động các trường nhập liệu (tên hiển thị, đơn vị) thay vì hardcode ở frontend.
 */
@Injectable()
export class VitalItemService {
    constructor(private readonly prisma: PrismaService) { }

    async listActive() {
        return this.prisma.vitalSignItem.findMany({
            where: { isActive: true },
            orderBy: { itemName: 'asc' },
        });
    }
}
