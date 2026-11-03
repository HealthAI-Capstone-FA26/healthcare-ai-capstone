import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../../prisma/prisma.service';
import { RequestUser } from '../../../identity-access/auth/strategies/jwt.strategy';
import { CreatePatientMedicalHistoryDto } from './dto/create-patient-medical-history.dto';
import { UpdatePatientMedicalHistoryStatusDto } from './dto/update-patient-medical-history-status.dto';
import { FindPatientMedicalHistoryQueryDto } from './dto/find-patient-medical-history-query.dto';

@Injectable()
export class PatientMedicalHistoryService {
  constructor(private readonly prisma: PrismaService) { }

  private async assertPatientExists(patientId: string): Promise<void> {
    const patient = await this.prisma.patient.findUnique({ where: { patientId } });
    if (!patient) {
      throw new NotFoundException('Không tìm thấy bệnh nhân');
    }
  }

  // POST /patients/:patientId/medical-history — hồ sơ dài hạn, không gắn cứng vào 1 lượt khám:
  // mỗi lần khai báo tạo 1 dòng mới (không upsert theo patientId vì 1 bệnh nhân có thể có nhiều
  // bệnh nền/tiền sử phẫu thuật/tiền sử gia đình khác nhau).
  async create(
    patientId: string,
    dto: CreatePatientMedicalHistoryDto,
    currentUser: RequestUser,
  ) {
    await this.assertPatientExists(patientId);

    return this.prisma.patientMedicalHistory.create({
      data: {
        patientId,
        historyType: dto.historyType,
        conditionName: dto.conditionName,
        onsetDate: dto.onsetDate ? new Date(dto.onsetDate) : undefined,
        notes: dto.notes,
        recordedByUserId: currentUser.userId,
        recordedAt: new Date(),
      },
    });
  }

  async findByPatientId(patientId: string, query: FindPatientMedicalHistoryQueryDto) {
    await this.assertPatientExists(patientId);

    return this.prisma.patientMedicalHistory.findMany({
      where: { patientId, historyType: query.historyType },
      orderBy: { recordedAt: 'desc' },
    });
  }

  // PATCH /medical-history/:id/status — CHỈ cho đổi status (active/resolved/inactive), không cho
  // sửa conditionName/... (đúng nguyên tắc "không có giới hạn ghi đè, chỉ thêm dòng mới
  // hoặc đổi status" trong module3.md mục 5).
  async updateStatus(historyId: string, dto: UpdatePatientMedicalHistoryStatusDto) {
    const history = await this.prisma.patientMedicalHistory.findUnique({ where: { historyId } });
    if (!history) {
      throw new NotFoundException('Không tìm thấy tiền sử bệnh đã ghi nhận');
    }
    if (history.status === dto.status) {
      throw new BadRequestException(`Tiền sử bệnh này đã ở trạng thái '${dto.status}'`);
    }

    return this.prisma.patientMedicalHistory.update({
      where: { historyId },
      data: { status: dto.status },
    });
  }
}
