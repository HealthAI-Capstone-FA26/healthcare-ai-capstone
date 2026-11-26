import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { FindDrugsQueryDto } from './dtos/find-drugs-query.dto';

@Injectable()
export class DrugCatalogService {
    constructor(private readonly prisma: PrismaService) {}

    async findMany(query: FindDrugsQueryDto) {
        const isActive = query.isActive === undefined ? true : query.isActive === 'true';
        const keyword = query.search?.trim();

        const where: Prisma.DrugCatalogWhereInput = {
            isActive,
            ...(query.therapeuticClass ? { therapeuticClass: query.therapeuticClass } : {}),
            ...(query.route ? { route: query.route } : {}),
            ...(keyword
                ? {
                      OR: [
                          { drugCode: { contains: keyword, mode: 'insensitive' } },
                          { nationalListCode: { contains: keyword, mode: 'insensitive' } },
                          { drugName: { contains: keyword, mode: 'insensitive' } },
                          { genericName: { contains: keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        };

        return this.prisma.drugCatalog.findMany({
            where,
            orderBy: [{ drugName: 'asc' }, { strength: 'asc' }],
            ...(query.limit ? { take: query.limit } : {}),
        });
    }

    async findAll() {
        return this.prisma.drugCatalog.findMany({
            orderBy: [{ drugName: 'asc' }, { strength: 'asc' }],
        });
    }

    async findById(drugId: string) {
        const drug = await this.prisma.drugCatalog.findUnique({
            where: { drugId },
        });

        if (!drug) {
            throw new NotFoundException(`Không tìm thấy thuốc với ID "${drugId}"`);
        }

        return drug;
    }
}
