import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { generateUniqueCode } from '../../../common/utils/code-generator.util';
import { CreateExaminationFeeDto } from './dtos/create-examination-fee.dto';
import { UpdateExaminationFeeDto } from './dtos/update-examination-fee.dto';
import { FindExaminationFeesQueryDto } from './dtos/find-examination-fees-query.dto';

/**
 * Quản lý bảng giá khám (ExaminationFeeCatalog) — CRUD đơn giản, không phụ thuộc module nào
 * khác. InvoiceService (Phase 2) sẽ đọc dữ liệu từ đây để tính phí khám khi generate hoá đơn.
 */
@Injectable()
export class ExaminationFeeService {
  constructor(private readonly prisma: PrismaService) { }

  async create(dto: CreateExaminationFeeDto) {
    // Schema v2 không còn Department: bảng giá chỉ phân biệt theo feeType
    // (standard | follow_up | online_booking) — mỗi feeType chỉ có 1 mức phí đang active.
    const feeType = dto.feeType ?? 'standard';
    if (dto.isActive ?? true) {
      const existingActiveFee = await this.prisma.examinationFeeCatalog.findFirst({
        where: { feeType, isActive: true },
      });
      if (existingActiveFee) {
        throw new ConflictException(
          `Đã tồn tại phí khám loại '${feeType}' đang hoạt động; hãy cập nhật phí hiện tại`,
        );
      }
    }

    const feeCode = await generateUniqueCode('PK', (code) =>
      this.prisma.examinationFeeCatalog.findUnique({ where: { feeCode: code } }).then(Boolean),
    );

    return this.prisma.examinationFeeCatalog.create({
      data: {
        feeCode,
        feeName: dto.feeName,
        feeType,
        price: dto.price,
        isActive: dto.isActive ?? true,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      },
    });
  }

  async findAll(query: FindExaminationFeesQueryDto) {
    return this.prisma.examinationFeeCatalog.findMany({
      where: {
        ...(query.feeType ? { feeType: query.feeType } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      },
      orderBy: [{ feeType: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  async findById(feeId: string) {
    const fee = await this.prisma.examinationFeeCatalog.findUnique({
      where: { feeId },
    });
    if (!fee) {
      throw new NotFoundException(`Không tìm thấy mức phí khám ${feeId}`);
    }
    return fee;
  }

  async update(feeId: string, dto: UpdateExaminationFeeDto) {
    await this.findById(feeId);

    return this.prisma.examinationFeeCatalog.update({
      where: { feeId },
      data: {
        ...(dto.feeName !== undefined ? { feeName: dto.feeName } : {}),
        ...(dto.feeType !== undefined ? { feeType: dto.feeType } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.effectiveFrom !== undefined ? { effectiveFrom: new Date(dto.effectiveFrom) } : {}),
      },
    });
  }

  /**
   * Dùng nội bộ bởi InvoiceService: mức phí khám đang active, đã có hiệu lực, mới nhất theo
   * effectiveFrom, cho đúng loại phí (mặc định 'standard').
   */
  async findActiveFee(feeType: string = 'standard') {
    const now = new Date();

    return this.prisma.examinationFeeCatalog.findFirst({
      where: { feeType, isActive: true, effectiveFrom: { lte: now } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }
}
