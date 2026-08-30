import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { ChiefComplaintInputChannel, UpsertChiefComplaintDto } from './dto/upsert-chief-complaint.dto';

@Injectable()
export class ChiefComplaintService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertEncounterExists(encounterId: string): Promise<void> {
    const encounter = await this.prisma.encounter.findUnique({ where: { encounterId } });
    if (!encounter) {
      throw new NotFoundException('Không tìm thấy lượt khám');
    }
  }

  // POST /encounters/:encounterId/chief-complaint — upsert vì encounterId là unique trên bảng
  // chief_complaints (1 encounter chỉ có đúng 1 lý do khám, có thể sửa lại nếu nhập nhầm).
  async upsert(encounterId: string, dto: UpsertChiefComplaintDto, currentUser: RequestUser) {
    await this.assertEncounterExists(encounterId);

    // self_kiosk: bệnh nhân tự khai qua kiosk/app, không có nhân viên nào đứng ra ghi hộ ->
    // recordedByUserId phải null (đúng comment trong schema, đã vá cột thành nullable ở Phase 2).
    // Các kênh còn lại đều có người chịu trách nhiệm nhập liệu -> lấy từ CurrentUser.
    const recordedByUserId =
      dto.inputChannel === ChiefComplaintInputChannel.SELF_KIOSK ? null : currentUser.userId;

    return this.prisma.chiefComplaint.upsert({
      where: { encounterId },
      create: {
        encounterId,
        reasonForVisit: dto.reasonForVisit,
        symptoms: dto.symptoms,
        symptomOnsetDate: dto.symptomOnsetDate ? new Date(dto.symptomOnsetDate) : undefined,
        painLevel: dto.painLevel,
        inputChannel: dto.inputChannel,
        recordedByUserId,
      },
      update: {
        reasonForVisit: dto.reasonForVisit,
        symptoms: dto.symptoms,
        symptomOnsetDate: dto.symptomOnsetDate ? new Date(dto.symptomOnsetDate) : undefined,
        painLevel: dto.painLevel,
        inputChannel: dto.inputChannel,
        recordedByUserId,
      },
    });
  }

  async findByEncounterId(encounterId: string) {
    const chiefComplaint = await this.prisma.chiefComplaint.findUnique({ where: { encounterId } });
    if (!chiefComplaint) {
      throw new NotFoundException('Lượt khám này chưa khai báo lý do khám');
    }
    return chiefComplaint;
  }
}