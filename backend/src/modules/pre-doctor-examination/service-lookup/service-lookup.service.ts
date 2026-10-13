import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { FindServicesQueryDto } from './dto/find-services-query.dto';

/**
 * SE02 — Tra cứu danh mục dịch vụ cận lâm sàng (ServiceCatalog) để bác sĩ chọn khi chỉ định.
 * Thay thế test-recommendation (DiagnosisTestRecommendation không còn trong schema). Chỉ ĐỌC.
 */
@Injectable()
export class ServiceLookupService {
    constructor(private readonly prisma: PrismaService) {}

    async find(query: FindServicesQueryDto) {
        const where: Prisma.ServiceCatalogWhereInput = {
            isActive: true,
            ...(query.modality ? { modality: query.modality } : {}),
            ...(query.panelGroup ? { panelGroup: query.panelGroup } : {}),
            ...(query.q
                ? {
                      OR: [
                          { serviceName: { contains: query.q, mode: 'insensitive' } },
                          { serviceCode: { contains: query.q, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        };

        const items = await this.prisma.serviceCatalog.findMany({
            where,
            orderBy: [{ modality: 'asc' }, { panelGroup: 'asc' }, { serviceName: 'asc' }],
            include: {
                defaultRoom: {
                    select: {
                        diagnosticRoomId: true,
                        diagnosticRoomCode: true,
                        diagnosticRoomName: true,
                        modality: true,
                        location: true,
                    },
                },
            },
        });

        const groupMap = new Map<string, { modality: string; panelGroup: string | null; services: typeof items }>();
        for (const item of items) {
            const key = `${item.modality}::${item.panelGroup ?? ''}`;
            const group = groupMap.get(key) ?? { modality: item.modality, panelGroup: item.panelGroup, services: [] };
            group.services.push(item);
            groupMap.set(key, group);
        }

        return { total: items.length, items, groups: Array.from(groupMap.values()) };
    }
}
