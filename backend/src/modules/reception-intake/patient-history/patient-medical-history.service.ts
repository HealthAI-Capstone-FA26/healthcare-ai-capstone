import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { CreatePatientMedicalHistoryDto } from './dto/create-patient-medical-history.dto';
import { UpdatePatientMedicalHistoryStatusDto } from './dto/update-patient-medical-history-status.dto';
import { FindPatientMedicalHistoryQueryDto } from './dto/find-patient-medical-history-query.dto';

@Injectable()
export class PatientMedicalHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertPatientExists(patientId: string): Promise<void> {
    const patient = await this.prisma.patient.findUnique({ where: { patientId } });
    if (!patient) {
      throw new NotFoundException('Không tìm thấy bệnh nhân');
    }
  }

  private async assertEncounterExists(encounterId: string): Promise<void> {
    const encounter = await this.prisma.encounter.findUnique({ where: { encounterId } });
    if (!encounter) {
      throw new NotFoundException('Không tìm thấy lượt khám');
    }
  }

  // module3.md mục 5 ghi "icd10Code optional, chưa validate tồn tại vì bảng ICD10_CODES thuộc
  // Module 5, chỉ lưu string tạm" — nhưng schema thật (đã migrate) đã có sẵn bảng icd10_codes VÀ
  // quan hệ FK thật từ PatientMedicalHistory.icd10Code tới Icd10Code.icd10Code, nên nếu không
  // kiểm tra trước, insert với mã không tồn tại sẽ vỡ FK constraint ở tầng DB (lỗi khó hiểu cho
  // FE). Validate ở tầng service cho ra lỗi rõ ràng, bám đúng schema thật thay vì mô tả cũ.
  private async assertIcd10CodeExists(icd10Code: string): Promise<void> {
    const code = await this.prisma.icd10Code.findUnique({ where: { icd10Code } });
    if (!code) {
      throw new BadRequestException(`Mã ICD-10 '${icd10Code}' không tồn tại`);
    }
  }

  // POST /patients/:patientId/medical-history — hồ sơ dài hạn, không gắn cứng vào 1 lượt khám:
  // mỗi lần khai báo tạo 1 dòng mới, encounterId chỉ để audit lượt khám nào ghi nhận (đúng
  // module3.md mục 5, không upsert theo patientId vì 1 bệnh nhân có thể có nhiều bệnh nền/tiền sử
  // phẫu thuật/tiền sử gia đình khác nhau).
  async create(
    patientId: string,
    dto: CreatePatientMedicalHistoryDto,
    currentUser: RequestUser,
  ) {
    await this.assertPatientExists(patientId);
    if (dto.encounterId) {
      await this.assertEncounterExists(dto.encounterId);
    }
    if (dto.icd10Code) {
      await this.assertIcd10CodeExists(dto.icd10Code);
    }

    return this.prisma.patientMedicalHistory.create({
      data: {
        patientId,
        historyType: dto.historyType,
        conditionName: dto.conditionName,
        icd10Code: dto.icd10Code,
        onsetDate: dto.onsetDate ? new Date(dto.onsetDate) : undefined,
        notes: dto.notes,
        encounterId: dto.encounterId,
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
  // sửa conditionName/icd10Code/... (đúng nguyên tắc "không có giới hạn ghi đè, chỉ thêm dòng mới
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
