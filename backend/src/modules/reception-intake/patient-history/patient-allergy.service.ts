import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../prisma/prisma.service';
import { RequestUser } from '../../auth/strategies/jwt.strategy';
import { CreatePatientAllergyDto } from './dto/create-patient-allergy.dto';
import { UpdatePatientAllergyStatusDto } from './dto/update-patient-allergy-status.dto';
import { FindPatientAllergyQueryDto } from './dto/find-patient-allergy-query.dto';

@Injectable()
export class PatientAllergyService {
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

  // POST /patients/:patientId/allergies — hồ sơ dài hạn, không gắn cứng vào 1 lượt khám (khác
  // ChiefComplaint/Consent): mỗi lần khai báo tạo 1 dòng mới, encounterId chỉ để audit lượt khám
  // nào ghi nhận (đúng module3.md mục 5, không upsert theo patientId vì 1 bệnh nhân có thể có
  // nhiều dị ứng khác nhau).
  async create(patientId: string, dto: CreatePatientAllergyDto, currentUser: RequestUser) {
    await this.assertPatientExists(patientId);
    if (dto.encounterId) {
      await this.assertEncounterExists(dto.encounterId);
    }

    return this.prisma.patientAllergy.create({
      data: {
        patientId,
        allergyType: dto.allergyType,
        allergenName: dto.allergenName,
        reactionDescription: dto.reactionDescription,
        severity: dto.severity,
        encounterId: dto.encounterId,
        recordedByUserId: currentUser.userId,
        recordedAt: new Date(),
      },
    });
  }

  async findByPatientId(patientId: string, query: FindPatientAllergyQueryDto) {
    await this.assertPatientExists(patientId);

    return this.prisma.patientAllergy.findMany({
      where: { patientId, status: query.status },
      orderBy: { recordedAt: 'desc' },
    });
  }

  // PATCH /allergies/:id/status — CHỈ cho đổi status (active/resolved/entered_in_error), không
  // cho sửa allergenName/severity/... (đúng nguyên tắc "không có giới hạn ghi đè, chỉ thêm dòng
  // mới hoặc đổi status" trong module3.md mục 5).
  async updateStatus(allergyId: string, dto: UpdatePatientAllergyStatusDto) {
    const allergy = await this.prisma.patientAllergy.findUnique({ where: { allergyId } });
    if (!allergy) {
      throw new NotFoundException('Không tìm thấy dị ứng đã ghi nhận');
    }
    if (allergy.status === dto.status) {
      throw new BadRequestException(`Dị ứng này đã ở trạng thái '${dto.status}'`);
    }

    return this.prisma.patientAllergy.update({
      where: { allergyId },
      data: { status: dto.status },
    });
  }
}
