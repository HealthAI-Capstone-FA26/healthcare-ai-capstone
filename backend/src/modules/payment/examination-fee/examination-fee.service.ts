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
    const existingActiveFee = await this.prisma.examinationFeeCatalog.findFirst({
      where: { departmentId: null, isActive: true },
    });
    if (existingActiveFee) {
      throw new ConflictException('Đã tồn tại phí khám chung đang hoạt động; hãy cập nhật phí hiện tại');
    }

    const feeCode = await generateUniqueCode('PK', (code) =>
      this.prisma.examinationFeeCatalog.findUnique({ where: { feeCode: code } }).then(Boolean),
    );

    return this.prisma.examinationFeeCatalog.create({
      data: {
        feeCode,
        departmentId: null,
        feeName: dto.feeName,
        feeType: dto.feeType ?? 'standard',
        price: dto.price,
        isActive: dto.isActive ?? true,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      },
    });
  }

  async findAll(query: FindExaminationFeesQueryDto) {
    return this.prisma.examinationFeeCatalog.findMany({
      where: {
        departmentId: null,
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      },
      orderBy: [{ departmentId: 'asc' }, { effectiveFrom: 'desc' }],
      include: { department: true },
    });
  }

  async findById(feeId: string) {
    const fee = await this.prisma.examinationFeeCatalog.findUnique({
      where: { feeId },
      include: { department: true },
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
        departmentId: null,
        ...(dto.feeName !== undefined ? { feeName: dto.feeName } : {}),
        ...(dto.feeType !== undefined ? { feeType: dto.feeType } : {}),
        ...(dto.price !== undefined ? { price: dto.price } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.effectiveFrom !== undefined ? { effectiveFrom: new Date(dto.effectiveFrom) } : {}),
      },
    });
  }

  /**
   * Dùng nội bộ bởi InvoiceService (§3.1 bước 2): mức phí khám đang active, đã có hiệu lực,
   * mới nhất theo effectiveFrom, cho đúng departmentId (hoặc phí chung departmentId=null nếu
   * khoa đó chưa có mức phí riêng).
   */
  async findActiveFeeForDepartment(_departmentId: string) {
    const now = new Date();

    // Chỉ có một bảng giá chung cho mọi khoa và mọi người.
    return this.prisma.examinationFeeCatalog.findFirst({
      where: { departmentId: null, isActive: true, effectiveFrom: { lte: now } },
      orderBy: { effectiveFrom: 'desc' },
    });
  }
}
