import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../../prisma/prisma.service';
import { SearchIcd10Dto } from './dto/search-icd10.dto';

/**
 * Nguồn tra cứu danh mục ICD-10 DÙNG CHUNG cho Module 5 (Khám & chỉ định xét nghiệm) và
 * Module 8 (Chẩn đoán hậu xét nghiệm & Tư vấn) — cả hai đều cần bác sĩ chọn/xác nhận mã bệnh
 * chuẩn hoá quốc tế khi ghi nhận chẩn đoán. Tách thành module riêng (thay vì mỗi module tự
 * query bảng icd10_codes) để tránh 2 module chỉ-định-xét-nghiệm/hậu-xét-nghiệm phải import
 * chéo lẫn nhau, giữ đúng yêu cầu module-based, không đè lẫn nhau.
 */
@Injectable()
export class Icd10CatalogService {
    constructor(private readonly prisma: PrismaService) {}

    async search(query: SearchIcd10Dto) {
        const isActive = query.isActive === undefined ? true : query.isActive === 'true';

        const where: Prisma.Icd10CodeWhereInput = {
            isActive,
            ...(query.chapter ? { chapter: query.chapter } : {}),
            ...(query.search
                ? {
                      OR: [
                          { icd10Code: { contains: query.search, mode: 'insensitive' } },
                          { icd10Name: { contains: query.search, mode: 'insensitive' } },
                          { icd10NameVi: { contains: query.search, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        };

        return this.prisma.icd10Code.findMany({
            where,
            orderBy: { icd10Code: 'asc' },
            take: query.limit ?? 20,
        });
    }

    async getByCode(icd10Code: string) {
        const code = await this.prisma.icd10Code.findUnique({ where: { icd10Code } });
        if (!code) {
            throw new NotFoundException(`Không tìm thấy mã ICD-10 '${icd10Code}'`);
        }
        return code;
    }

    /** Assert nhanh mã tồn tại & đang active — dùng bởi các service ghi Diagnosis/AiDiagnosisSuggestion. */
    async assertActiveCode(icd10Code: string): Promise<void> {
        const code = await this.getByCode(icd10Code);
        if (!code.isActive) {
            throw new NotFoundException(`Mã ICD-10 '${icd10Code}' đã ngưng sử dụng, vui lòng chọn mã khác.`);
        }
    }
}
