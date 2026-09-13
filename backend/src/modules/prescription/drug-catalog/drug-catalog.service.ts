import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { SearchDrugDto } from './dtos/search-drug.dto';

@Injectable()
export class DrugCatalogService {
    constructor(private readonly prisma: PrismaService) {}

    // GET /prescriptions/drug-catalog?query=&page=&limit= — autocomplete cho UI kê đơn.
    async search(dto: SearchDrugDto) {
        const page = dto.page ?? 1;
        const limit = dto.limit ?? 20;

        const where: Prisma.DrugCatalogWhereInput = { isActive: true };

        if (dto.query) {
            where.OR = [
                { drugName: { contains: dto.query, mode: 'insensitive' } },
                { genericName: { contains: dto.query, mode: 'insensitive' } },
                { drugCode: { contains: dto.query, mode: 'insensitive' } },
            ];
        }

        const [items, total] = await Promise.all([
            this.prisma.drugCatalog.findMany({
                where,
                include: { allergenCategory: true },
                orderBy: { drugName: 'asc' },
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.drugCatalog.count({ where }),
        ]);

        return {
            items,
            total,
            page,
            limit,
        };
    }

    // GET /prescriptions/drug-catalog/:drugId — chi tiết thuốc kèm allergenCategory và toàn bộ
    // DrugInteraction mà thuốc này tham gia (cả 2 chiều drugIdA/drugIdB), để FE cảnh báo sớm.
    async findById(drugId: string) {
        const drug = await this.prisma.drugCatalog.findUnique({
            where: { drugId },
            include: {
                allergenCategory: true,
                interactionsA: { where: { isActive: true }, include: { drugB: true } },
                interactionsB: { where: { isActive: true }, include: { drugA: true } },
            },
        });

        if (!drug) {
            throw new NotFoundException('Không tìm thấy thuốc trong danh mục');
        }

        return drug;
    }
}
